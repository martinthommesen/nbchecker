/**
 * Checks one target against every filter, this computer's DNS and an
 * unfiltered resolver.
 */
import { Duration, Effect, Ref, Result } from "effect";
import {
  classifyAll,
  classifySystem,
  noReference,
  type Reference,
} from "./classify.ts";
import type { Filter } from "./filters.ts";
import { normalize } from "./normalize.ts";
import { CheckerOptions } from "./options.ts";
import { Progress } from "./progress.ts";
import { askFilter, askUnfiltered, type ServerAnswer } from "./remote.ts";
import {
  type CheckResult,
  completionOf,
  type Network,
  type Outcome,
  pending,
  type RealAnswer,
  unchecked,
} from "./result.ts";
import {
  lookupSystem,
  reverseName,
  type SystemAnswer,
  systemServer,
} from "./system.ts";

const ipNote =
  "DNS filters block names, not IP addresses, so an IP address you connect to directly is not blocked by them.";

/** One lookup's result and how long it took. */
interface Asked<A> {
  readonly ms: number;
  readonly result: Result.Result<A, { readonly message: string }>;
}

/** Everything that has answered so far. */
interface Gathered {
  readonly filters: readonly (Asked<ServerAnswer> | undefined)[];
  readonly network: Network | undefined;
  readonly realAnswer: Asked<ServerAnswer & Reference> | undefined;
  readonly system: Asked<SystemAnswer> | undefined;
}

/**
 * How one lookup stands: pending until it is asked, failed with its error,
 * or answered with what `toAnswered` makes of the answer and its time.
 */
const outcomeOf = <A, B>(
  asked: Asked<A> | undefined,
  toAnswered: (answer: A, ms: number) => B
): Outcome<B> => {
  if (asked === undefined) {
    return pending;
  }
  const { ms, result } = asked;
  if (Result.isFailure(result)) {
    return { error: result.failure.message, kind: "failed", ms };
  }
  return { ...toAnswered(result.success, ms), kind: "answered" };
};

/**
 * What every answer is compared with. Until the real answer arrives, or if
 * it can't be fetched, a missing name is not a block.
 */
const referenceOf = (realAnswer: Outcome<RealAnswer>): Reference => {
  if (realAnswer.kind !== "answered") {
    return noReference;
  }
  return realAnswer;
};

/** Builds the result from what has answered, classifying it afresh. */
const assemble = (
  base: CheckResult,
  asked: readonly Filter[],
  g: Gathered
): CheckResult => {
  const realAnswer = outcomeOf(g.realAnswer, (a, ms) => ({
    addresses: a.addresses,
    exchange: { answers: a.answers, ms, server: a.server },
    exists: a.exists,
  }));
  const reference = referenceOf(realAnswer);
  const filterAnswered = (a: ServerAnswer, ms: number) => ({
    exchange: { answers: a.answers, ms, server: a.server },
    verdict: classifyAll(a.answers, reference),
  });
  const systemAnswered = (a: SystemAnswer, ms: number) => ({
    exchange: { answers: [a.answer], ms, notes: a.notes, server: systemServer },
    verdict: classifySystem(a.answer, a.noAddress, reference),
  });
  const result: CheckResult = {
    ...base,
    checked: true,
    filters: asked.map((filter, i) => ({
      filter,
      outcome: outcomeOf(g.filters[i], filterAnswered),
    })),
    network: g.network,
    realAnswer,
    system: outcomeOf(g.system, systemAnswered),
  };
  return { ...result, completion: completionOf(result) };
};

const timedResult = <A, E extends { readonly message: string }, R>(
  effect: Effect.Effect<A, E, R>
) =>
  effect.pipe(
    Effect.result,
    Effect.timed,
    Effect.map(
      ([duration, result]): Asked<A> => ({
        ms: Math.round(Duration.toMillis(duration)),
        result,
      })
    )
  );

/**
 * Asks everything about one name at once, reporting each answer. `query` is
 * the name as looked up, which can end in a dot that the shown name drops.
 */
const checkName = <NetworkNeeds>(
  base: CheckResult,
  network: Effect.Effect<Network, never, NetworkNeeds>,
  query = base.host
) =>
  Effect.gen(function* () {
    const options = yield* CheckerOptions;
    const progress = yield* Progress;
    const state = yield* Ref.make<Gathered>({
      filters: options.filters.map(() => undefined),
      network: undefined,
      realAnswer: undefined,
      system: undefined,
    });
    const report = (update: (g: Gathered) => Gathered) =>
      Ref.updateAndGet(state, update).pipe(
        Effect.flatMap((g) => progress(assemble(base, options.filters, g)))
      );
    const record = <A, E extends { readonly message: string }, R>(
      effect: Effect.Effect<A, E, R>,
      update: (g: Gathered, a: Asked<A>) => Gathered
    ) =>
      timedResult(effect).pipe(
        Effect.flatMap((a) => report((g) => update(g, a)))
      );
    yield* progress(assemble(base, options.filters, yield* Ref.get(state)));
    yield* Effect.all(
      [
        record(
          askUnfiltered(options.unfilteredResolvers, query),
          (g, realAnswer) => ({ ...g, realAnswer })
        ),
        record(lookupSystem(query, base.host), (g, system) => ({
          ...g,
          system,
        })),
        // Says whether an ISP's filter should have answered this computer,
        // and which filters' answers can be trusted.
        network.pipe(
          Effect.flatMap((n) => report((g) => ({ ...g, network: n })))
        ),
        ...options.filters.map((f, i) =>
          record(askFilter(f, query), (g, a) => ({
            ...g,
            filters: g.filters.with(i, a),
          }))
        ),
      ],
      { concurrency: "unbounded", discard: true }
    );
    return assemble(base, options.filters, yield* Ref.get(state));
  });

/** Checks an IP address by its reverse DNS name, as filters only see names. */
const checkIp = <NetworkNeeds>(
  target: string,
  ip: string,
  network: Effect.Effect<Network, never, NetworkNeeds>
) =>
  Effect.gen(function* () {
    const base = unchecked(target, ip, true);
    const named = yield* reverseName(ip).pipe(Effect.result);
    if (Result.isFailure(named)) {
      const error = named.failure.message;
      return {
        ...base,
        completion: "incomplete",
        lookupError: error,
        notes: [ipNote, `Could not look up its reverse DNS name: ${error}`],
      } satisfies CheckResult;
    }
    const name = named.success;
    if (name === undefined) {
      return {
        ...base,
        notes: [
          ipNote,
          "The address has no reverse DNS name, so there is nothing else to check.",
        ],
      } satisfies CheckResult;
    }
    return yield* checkName(
      {
        ...base,
        host: name,
        notes: [ipNote, `Checking its reverse DNS name ${name} instead.`],
      },
      network
    );
  });

/**
 * Checks a domain, URL or IP address. `network` is found out once per run,
 * by `detectNetwork`, and shared by every check.
 */
export const check = <NetworkNeeds>(
  target: string,
  network: Effect.Effect<Network, never, NetworkNeeds>
) =>
  Effect.gen(function* () {
    const t = normalize(target);
    if (t.kind === "invalid") {
      const error = `${t.host} is not a domain, URL or IP address`;
      return {
        ...unchecked(target, t.host, false),
        completion: "incomplete",
        lookupError: error,
        notes: [error],
      } satisfies CheckResult;
    }
    if (t.kind === "domain") {
      return yield* checkName(
        unchecked(target, t.host, false),
        network,
        t.query
      );
    }
    return yield* checkIp(target, t.host, network);
  });
