import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { check } from "../check/checker.ts";
import { detectNetwork } from "../check/network.ts";
import { CheckerOptions } from "../check/options.ts";
import { Progress } from "../check/progress.ts";
import {
  type CheckResult,
  cancelPending,
  pending,
  unchecked,
} from "../check/result.ts";
import { exitCode, exitIncomplete } from "../cli/exit-status.ts";
import {
  computer,
  fakeFilters,
  fakeTransport,
  realAnswerUrl,
} from "../testing/fake-network.ts";
import { runCheck } from "../testing/run-check.ts";
import { toJson } from "./json.ts";
import { renderText } from "./text.ts";
import { view } from "./view.ts";

const exported = (r: CheckResult) =>
  toJson({ dnsFilter: "", version: "" }, [r]).results[0];

/** The check as it stood before anything answered, then cancelled. */
const cancelledAtOnce = Effect.gen(function* () {
  const seen: CheckResult[] = [];
  yield* check("bad.example", detectNetwork).pipe(
    Effect.provideService(Progress, (sofar) =>
      Effect.sync(() => {
        seen.push(sofar);
      })
    ),
    Effect.provideService(CheckerOptions, {
      filters: fakeFilters,
      unfilteredResolvers: [realAnswerUrl],
    }),
    Effect.provide(Layer.merge(fakeTransport, computer))
  );
  const [first] = seen;
  if (first === undefined) {
    throw new Error("no progress was reported");
  }
  return cancelPending(first);
});

describe("a cancelled check", () => {
  test("says it was cancelled when copied or exported", async () => {
    const r = await Effect.runPromise(cancelledAtOnce);
    const copied = renderText(view(r), false);
    expect(copied).toContain(
      "? cancelled: 0 of 2 filters answered first, 0 of them blocking"
    );
    expect(copied).toContain("cancelled before it answered");
    expect(copied).not.toContain("not blocked");
    expect(exported(r)).toMatchObject({
      completion: "cancelled",
      status: "cancelled",
    });
    expect(exitCode([r])).toBe(exitIncomplete);
  });

  test("says in JSON which lookups were cut short", async () => {
    const json = exported(await Effect.runPromise(cancelledAtOnce));
    const cancelled = { blocked: false, error: "cancelled" };
    expect(json).toMatchObject({
      exists: false,
      realAnswer: [],
      realAnswerError: "cancelled",
      thisComputer: cancelled,
    });
    expect(json?.filters).toEqual(
      fakeFilters.map((f) => ({
        category: f.category,
        name: f.name,
        ...cancelled,
      }))
    );
  });

  test("leaves out what an unchecked target never asked", () => {
    const r = cancelPending(unchecked("192.0.2.98", "192.0.2.98", true));
    const json = exported(r);
    expect(json?.realAnswerError).toBeUndefined();
    expect(json?.thisComputer).toBeUndefined();
  });
});

describe("a checked result in JSON", () => {
  test("keeps its keys in one order", async () => {
    const json = exported(await runCheck("bad.example"));
    expect(Object.keys(json ?? {})).toEqual([
      "blocked",
      "completion",
      "error",
      "exists",
      "filters",
      "host",
      "isIp",
      "notes",
      "realAnswer",
      "realAnswerError",
      "status",
      "target",
      "thisComputer",
    ]);
  });

  test("says this computer wasn't asked while its lookup is pending", async () => {
    const r = await runCheck("good.example");
    expect(exported({ ...r, system: pending })?.thisComputer).toEqual({
      blocked: false,
      error: "not asked",
    });
  });
});
