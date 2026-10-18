/**
 * Checks one target against every filter, this computer's DNS and an
 * unfiltered resolver.
 */
import { Context, Effect, Result } from "effect";
import { classify, merge, type Verdict } from "./classify.ts";
import { type Filter, filters, truthResolvers } from "./filters.ts";
import { lookupSystem, reverseName } from "./local.ts";
import { normalize } from "./normalize.ts";
import { askFilter, lookupTruth } from "./remote.ts";
import { type CheckResult, type Outcome, unchecked } from "./result.ts";

const outcomeOf = <
  A extends { readonly server: string },
  E extends { readonly message: string },
>(
  result: Result.Result<A, E>,
  verdict: (a: A) => Verdict
): Outcome => {
  if (Result.isSuccess(result)) {
    return {
      kind: "answered",
      server: result.success.server,
      verdict: verdict(result.success),
    };
  }
  return { error: result.failure.message, kind: "failed" };
};

const notAsked = Result.fail({ message: "not asked" });

/** Asks everything about one name at once, then classifies the answers. */
const checkName = (base: CheckResult) =>
  Effect.gen(function* () {
    const options = yield* CheckerOptions;
    const [truth, system, answers] = yield* Effect.all(
      [
        lookupTruth(options.truthUrls, base.host).pipe(Effect.result),
        lookupSystem(base.host).pipe(Effect.result),
        Effect.forEach(
          options.filters,
          (f) => askFilter(f, base.host).pipe(Effect.result),
          { concurrency: "unbounded" }
        ),
      ],
      { concurrency: "unbounded" }
    );
    // Classify once the truth is known, so an NXDOMAIN can be judged. If the
    // truth is unknown, a missing name is not counted as a block.
    const exists = Result.isSuccess(truth) && truth.success.exists;
    return {
      ...base,
      checked: true,
      exists,
      filters: options.filters.map((filter, i) => ({
        filter,
        outcome: outcomeOf(answers[i] ?? notAsked, (a) =>
          merge(...a.answers.map((answer) => classify(answer, exists)))
        ),
      })),
      system: outcomeOf(
        Result.map(system, (answer) => ({ answer, server: "this computer" })),
        (s) => classify(s.answer, exists)
      ),
      truth: Result.match(truth, {
        onFailure: () => [],
        onSuccess: (t) => t.addresses,
      }),
      truthError: Result.match(truth, {
        onFailure: (e) => e.message,
        onSuccess: () => undefined,
      }),
    } satisfies CheckResult;
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
