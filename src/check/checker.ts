/**
 * Checks one target against every filter, this computer's DNS and an
 * unfiltered resolver.
 */
import { Context, Duration, Effect, Ref, Result } from "effect";
import { QueryError } from "../dns/query-error.ts";
import type { DnsAnswer } from "../dns/wire.ts";
import { classify, merge, type Verdict } from "./classify.ts";
import { type Filter, filters, truthResolvers } from "./filters.ts";
import { lookupSystem, reverseName } from "./local.ts";
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
  readonly system: Asked<FilterAnswer> | undefined;
  readonly truth: Asked<Truth> | undefined;
}

const outcomeOf = (
  asked: Asked<FilterAnswer> | undefined,
  transport: string,
  exists: boolean
): Outcome => {
  if (asked === undefined) {
    return pending;
  }
  const { ms, result } = asked;
  if (Result.isFailure(result)) {
    return { error: result.failure.message, kind: "failed", ms };
  }
  const { answers, server } = result.success;
  const verdict: Verdict = merge(...answers.map((a) => classify(a, exists)));
  return {
    exchange: { answers, ms, server, transport },
    kind: "answered",
    verdict,
  };
};

/** Builds the result from what has answered, classifying it afresh. */
const assemble = (
  base: CheckResult,
  asked: readonly Filter[],
  g: Gathered
): CheckResult => {
  const truth = g.truth?.result;
  // Classify once the truth is known, so an NXDOMAIN can be judged. Until
  // then, or if the truth is unknown, a missing name is not a block.
  const exists =
    truth !== undefined && Result.isSuccess(truth) && truth.success.exists;
  const result: CheckResult = {
    ...base,
    checked: true,
    exists,
    filters: asked.map((filter, i) => ({
      filter,
      outcome: outcomeOf(g.filters[i], "UDP 53", exists),
    })),
    system: outcomeOf(g.system, "system resolver", exists),
  };
  if (g.truth === undefined || truth === undefined) {
    return result;
  }
  if (Result.isFailure(truth)) {
    return { ...result, truthError: truth.failure.message };
  }
  return {
    ...result,
    truth: truth.success.addresses,
    truthExchange: {
      answers: truth.success.answers,
      ms: g.truth.ms,
      server: truth.success.server,
      transport: "HTTPS 443",
    },
  };
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
  lookupSystem(host).pipe(
    Effect.timeoutOrElse({
      duration: systemTimeout,
      orElse: () =>
        Effect.fail(
          new QueryError({
            reason: "no answer (timed out)",
            server: "this computer",
          })
        ),
    }),
    Effect.map(
      (answer: DnsAnswer): FilterAnswer => ({
        answers: [answer],
        server: "this computer",
      })
    )
  );

/** Asks everything about one name at once, reporting each answer. */
const checkName = (base: CheckResult) =>
  Effect.gen(function* () {
    const options = yield* CheckerOptions;
    const progress = yield* Progress;
    const state = yield* Ref.make<Gathered>({
      filters: options.filters.map(() => undefined),
      system: undefined,
      truth: undefined,
    });
    const record = <A, E extends { readonly message: string }, R>(
      effect: Effect.Effect<A, E, R>,
      update: (g: Gathered, a: Asked<A>) => Gathered
    ) =>
      timedResult(effect).pipe(
        Effect.flatMap((a) => Ref.updateAndGet(state, (g) => update(g, a))),
        Effect.flatMap((g) => progress(assemble(base, options.filters, g)))
      );
    yield* progress(assemble(base, options.filters, yield* Ref.get(state)));
    yield* Effect.all(
      [
        record(lookupTruth(options.truthUrls, base.host), (g, truth) => ({
          ...g,
          truth,
        })),
        record(systemAnswer(base.host), (g, system) => ({ ...g, system })),
        ...options.filters.map((f, i) =>
          record(askFilter(f, base.host), (g, a) => ({
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

/** Checks a domain, URL or IP address. */
export const check = (target: string) =>
  Effect.gen(function* () {
    const t = normalize(target);
    if (t.kind === "invalid") {
      const error = `${t.host} is not a domain, URL or IP address`;
      return {
        ...unchecked(target, t.host, false),
        lookupError: error,
        notes: [error],
      } satisfies CheckResult;
    }
    if (t.kind === "domain") {
      return yield* checkName(unchecked(target, t.host, false));
    }
    const named = yield* reverseName(target, t.host);
    if (named.host === t.host || named.lookupError !== undefined) {
      return named;
    }
    return yield* checkName(named);
  });
