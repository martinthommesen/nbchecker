import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { check } from "../check/checker.ts";
import { detectNetwork } from "../check/network.ts";
import { CheckerOptions } from "../check/options.ts";
import { Progress } from "../check/progress.ts";
import { type CheckResult, cancelPending } from "../check/result.ts";
import { exitCode, exitIncomplete } from "../cli/exit-status.ts";
import {
  computer,
  fakeFilters,
  fakeTransport,
} from "../testing/fake-network.ts";
import { realAnswerUrl } from "../testing/run-check.ts";
import { toJson } from "./json.ts";
import { renderText } from "./text.ts";
import { view } from "./view.ts";

describe("a cancelled check", () => {
  const firstReport = Effect.gen(function* () {
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
    return seen[0];
  });

  test("says it was cancelled when copied or exported", async () => {
    const partial = await Effect.runPromise(firstReport);
    if (partial === undefined) {
      throw new Error("no progress was reported");
    }
    const r = cancelPending(partial);
    const copied = renderText(view(r), false);
    expect(copied).toContain(
      "? cancelled: 0 of 2 filters answered first, 0 of them blocking"
    );
    expect(copied).toContain("cancelled before it answered");
    expect(copied).not.toContain("not blocked");
    const [exported] = toJson({ dnsFilter: "", version: "" }, [r]).results;
    expect(exported).toMatchObject({
      completion: "cancelled",
      status: "cancelled",
    });
    expect(exitCode([r])).toBe(exitIncomplete);
  });
});
