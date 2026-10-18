/**
 * Checks one target against every filter, this computer's DNS and an
 * unfiltered resolver.
 */
import { Context, Duration, Effect, Ref, Result } from "effect";
import { timeoutAfter } from "../dns/query-error.ts";
import {
  classifyAll,
  classifySystem,
  noReference,
  type Reference,
} from "./classify.ts";
import { type Filter, filters, truthResolvers } from "./filters.ts";
import { lookupSystem, reverseName, type SystemAnswer } from "./local.ts";
import { normalize } from "./normalize.ts";
import { Progress } from "./progress.ts";
import {
  askFilter,
  type FilterAnswer,
  lookupTruth,
  type Truth,
} from "./remote.ts";
import {
  type CheckResult,
  completionOf,
  type Network,
  type Outcome,
  pending,
  unchecked,
} from "./result.ts";

/** One lookup's result and how long it took. */
interface Asked<A> {
  readonly ms: number;
  readonly result: Result.Result<A, { readonly message: string }>;
}

/** Everything that has answered so far. */
interface Gathered {
  readonly filters: readonly (Asked<FilterAnswer> | undefined)[];
  readonly network: Network | undefined;
  readonly system: Asked<SystemAnswer> | undefined;
  readonly truth: Asked<Truth> | undefined;
}

const systemServer = "this computer";

const filterOutcome = (
  asked: Asked<FilterAnswer> | undefined,
  reference: Reference
): Outcome => {
  if (asked === undefined) {
    return pending;
  }
  const { ms, result } = asked;
  if (Result.isFailure(result)) {
    return { error: result.failure.message, kind: "failed", ms };
  }
  const { answers, server } = result.success;
  return {
    exchange: { answers, ms, server, transport: "UDP 53" },
    kind: "answered",
    verdict: classifyAll(answers, reference),
  };
};

const systemOutcome = (
  asked: Asked<SystemAnswer> | undefined,
  reference: Reference
): Outcome => {
  if (asked === undefined) {
    return pending;
  }
  const { ms, result } = asked;
  if (Result.isFailure(result)) {
    return { error: result.failure.message, kind: "failed", ms };
  }
  const { answer, noAddress, notes } = result.success;
  return {
    exchange: {
      answers: [answer],
      ms,
      notes,
      server: systemServer,
      transport: "system resolver",
    },
    kind: "answered",
    verdict: classifySystem(answer, noAddress, reference),
  };
};

/**
 * What every answer is compared with. Until the real answer arrives, or if
 * it can't be fetched, a missing name is not a block.
 */
const referenceOf = (g: Gathered): Reference => {
  const truth = g.truth?.result;
  if (truth === undefined || Result.isFailure(truth)) {
    return noReference;
  }
  return truth.success;
};

/** Builds the result from what has answered, classifying it afresh. */
const assemble = (
  base: CheckResult,
  asked: readonly Filter[],
  g: Gathered
): CheckResult => {
  const truth = g.truth?.result;
  const reference = referenceOf(g);
  let result: CheckResult = {
    ...base,
    checked: true,
    exists: reference.exists,
    filters: asked.map((filter, i) => ({
      filter,
      outcome: filterOutcome(g.filters[i], reference),
    })),
    network: g.network,
    system: systemOutcome(g.system, reference),
  };
  if (g.truth !== undefined && truth !== undefined) {
    if (Result.isFailure(truth)) {
      result = { ...result, truthError: truth.failure.message };
    } else {
      result = {
        ...result,
        truth: truth.success.addresses,
        truthExchange: {
          answers: truth.success.answers,
          ms: g.truth.ms,
          server: truth.success.server,
          transport: "HTTPS 443",
        },
      };
    }
  }
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

/** The system resolver retries on its own, so it gets longer than a filter. */
const systemTimeout = "5 seconds";

const systemAnswer = (host: string) =>
  lookupSystem(host).pipe(timeoutAfter(systemTimeout, systemServer));

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
      system: undefined,
      truth: undefined,
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
        record(lookupTruth(options.truthUrls, query), (g, truth) => ({
          ...g,
          truth,
        })),
        record(systemAnswer(query), (g, system) => ({ ...g, system })),
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

export interface CheckerOptions {
  readonly filters: readonly Filter[];
  readonly truthUrls: readonly string[];
}

/** Which filters and resolvers to ask; tests swap them for fakes. */
export const CheckerOptions = Context.Reference<CheckerOptions>(
  "nbchecker/CheckerOptions",
  { defaultValue: () => ({ filters, truthUrls: truthResolvers }) }
);

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
    const named = yield* reverseName(target, t.host);
    if (named.host === t.host || named.lookupError !== undefined) {
      return { ...named, completion: completionOf(named) };
    }
    return yield* checkName(named, network);
  });
