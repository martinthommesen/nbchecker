import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { Dns } from "effect/net";
import type { Filter } from "../check/filters.ts";
import { renderText } from "../report/text.ts";
import { view } from "../report/view.ts";
import {
  computer,
  computerWith,
  fakeCanary,
  fakeFilters,
  publicTestPage,
} from "../testing/fake-network.ts";
import { downTruthUrl, runCheck } from "../testing/run-check.ts";
import {
  exitBlocked,
  exitCode,
  exitIncomplete,
  exitNotBlocked,
} from "./exit-status.ts";

const ispFilter: Filter = {
  canary: fakeCanary,
  category: "security",
  name: "ISP filter",
  onlyAnswers: { customers: "Telenor customers", network: "Telenor" },
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
    expect(exitCode([await runCheck("good.example")])).toBe(exitNotBlocked);
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
    expect(exitCode([r])).toBe(exitNotBlocked);
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
