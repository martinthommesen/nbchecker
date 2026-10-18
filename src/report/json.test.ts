import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { Dns } from "effect/net";
import { CheckerOptions, check } from "../check/checker.ts";
import type { Filter } from "../check/filters.ts";
import { detectNetwork } from "../check/network.ts";
import { Progress } from "../check/progress.ts";
import { type CheckResult, cancelPending } from "../check/result.ts";
import { exitBlocked, exitCode, exitIncomplete } from "../cli/exit-status.ts";
import {
  computer,
  computerWith,
  fakeCanary,
  fakeFilters,
  fakeTransport,
  publicTestPage,
} from "../testing/fake-network.ts";
import { downTruthUrl, runCheck, truthUrl } from "../testing/run-check.ts";
import { toJson } from "./json.ts";
import { renderText } from "./text.ts";
import { view } from "./view.ts";

const ispFilter: Filter = {
  canary: fakeCanary,
  category: "security",
  name: "ISP filter",
  network: "Telenor",
  onlyAnswers: "Telenor customers",
  servers: ["203.0.113.1"],
};

const failing = Dns.make({
  lookup: (hostname) =>
    Effect.fail(
      new Dns.DnsError({ hostname, method: "lookup", reason: "ServerFailure" })
    ),
});

describe("exit status", () => {
  test("a clean check exits 0", async () => {
    expect(exitCode([await runCheck("good.example")])).toBe(0);
  });

  test("a failed real answer or system lookup makes the check incomplete", async () => {
    const noTruth = await runCheck("good.example", {
      truthUrls: [downTruthUrl],
    });
    expect(noTruth.completion).toBe("incomplete");
    expect(exitCode([noTruth])).toBe(exitIncomplete);
    const noSystem = await runCheck("good.example", {
      dns: Layer.succeed(Dns.Dns, failing),
    });
    expect(noSystem.system?.kind).toBe("failed");
    expect(exitCode([noSystem])).toBe(exitIncomplete);
  });

  test("a block exits 1", async () => {
    expect(exitCode([await runCheck("bad.example")])).toBe(exitBlocked);
  });

  test("a definite block wins over a filter that didn't answer", async () => {
    const r = await runCheck("bad.example", {
      filters: [
        ...fakeFilters,
        {
          canary: fakeCanary,
          category: "ads",
          name: "Down",
          servers: ["203.0.113.1"],
        },
      ],
    });
    expect(r.completion).toBe("incomplete");
    expect(exitCode([r])).toBe(exitBlocked);
    const clean = await runCheck("good.example", { truthUrls: [downTruthUrl] });
    expect(exitCode([clean, r])).toBe(exitBlocked);
  });
});

describe("exit status: a filter that only answers its own network", () => {
  const filters = [...fakeFilters, ispFilter];

  test("not answering elsewhere is expected", async () => {
    const r = await runCheck("good.example", {
      dns: computerWith(publicTestPage),
      filters,
    });
    expect(r.completion).toBe("complete");
    expect(exitCode([r])).toBe(0);
    expect(renderText(view(r), false)).toContain(
      "no answer (it only answers Telenor customers)"
    );
  });

  test("not answering on its own network makes the check incomplete", async () => {
    // This computer's DNS goes through Nettvern+, so it is on Telenor's network.
    const r = await runCheck("good.example", { dns: computer, filters });
    expect(r.completion).toBe("incomplete");
    expect(exitCode([r])).toBe(exitIncomplete);
    expect(renderText(view(r), false)).toContain(
      "? ISP filter       no answer"
    );
  });
});

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
        truthUrls: [truthUrl],
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
