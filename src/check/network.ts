/**
 * Finds out about this computer's network once per run: which filter its
 * DNS goes through, and whether each filter's answers really come from it.
 */
import { Effect, Result } from "effect";
import { CheckerOptions } from "./checker.ts";
import {
  canonicalAddress,
  classify,
  merge,
  type Reference,
} from "./classify.ts";
import { detectConnection } from "./connection.ts";
import type { Filter } from "./filters.ts";
import { askFilter } from "./remote.ts";
import type { Network, SelfTest } from "./result.ts";

/** A canary exists, so a filter saying it doesn't is a block. */
const canaryExists: Reference = { addresses: [], exists: true };

/**
 * Asks a filter for its canary, a name it documents as blocked. The filter
 * passes only if every address it answers, for A and AAAA alike, is its
 * documented block answer: any other address came from somewhere else, so
 * the network sent that query to another resolver. No answer says nothing
 * either way, as for Telenor's filters elsewhere.
 */
const selfTest = (filter: Filter) => {
  const { canary } = filter;
  if (canary === undefined) {
    return Effect.succeed<SelfTest>({
      answers: [],
      filter: filter.name,
      result: "untested",
    });
  }
  return askFilter(filter, canary.name).pipe(
    Effect.result,
    Effect.map((asked): SelfTest => {
      if (Result.isFailure(asked)) {
        return { answers: [], filter: filter.name, result: "no-answer" };
      }
      const verdict = merge(
        ...asked.success.answers.map((a) => classify(a, canaryExists))
      );
      // A CNAME, such as to Telenor's warning page, leads to an address.
      const addresses = asked.success.answers
        .flatMap((a) => a.records)
        .filter((r) => r.type !== "CNAME")
        .map((r) => canonicalAddress(r.value));
      const passed =
        addresses.length > 0 &&
        addresses.every((a) => canary.answers.includes(a));
      const test = { answers: verdict.answers, filter: filter.name };
      if (passed) {
        return { ...test, result: "passed" };
      }
      return { ...test, result: "redirected" };
    })
  );
};

/** Detects the connection and runs every filter's self-test at once. */
export const detectNetwork = Effect.gen(function* () {
  const options = yield* CheckerOptions;
  const network: Network = yield* Effect.all(
    {
      connection: detectConnection,
      selfTests: Effect.forEach(options.filters, selfTest, {
        concurrency: "unbounded",
      }),
    },
    { concurrency: "unbounded" }
  );
  return network;
});
