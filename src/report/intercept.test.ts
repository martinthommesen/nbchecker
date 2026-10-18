/**
 * Whole checks on networks that send DNS queries to their own resolver,
 * read the way every output reads them.
 */
import { describe, expect, test } from "bun:test";
import { Dns } from "effect/net";
import type { Filter } from "../check/filters.ts";
import { type CheckResult, isBlocked } from "../check/result.ts";
import {
  blockingRedirectTransport,
  computerWith,
  fakeFilters,
  publicTestPage,
  redirectingTransport,
  rewritingTransport,
} from "../testing/fake-network.ts";
import { runCheck } from "../testing/run-check.ts";
import { systemWhy } from "../tui/why.ts";
import { exitBlocked, exitCode, exitIncomplete, toJson } from "./json.ts";
import { statusOf } from "./status.ts";
import { renderText } from "./text.ts";
import { view } from "./view.ts";

const text = (r: CheckResult): string => renderText(view(r), false);

const json = (r: CheckResult) => toJson({ dnsFilter: "", version: "" }, [r]);

/** This computer gets the same redirected answers as the filters. */
const redirectedComputer = Dns.layerStatic({
  hosts: {
    "bad.example": ["192.0.2.10"],
    "good.example": ["192.0.2.20"],
    "nettvern.telenor.net": [publicTestPage],
  },
});

const intercepted = "DNS on this network seems to be intercepted";

describe("intercepted DNS: an honest network", () => {
  test("every filter passes the self-test and counts", async () => {
    const r = await runCheck("bad.example");
    expect(r.network?.selfTests.map((t) => t.result)).toEqual([
      "passed",
      "passed",
    ]);
    expect(text(r)).toContain("✗ blocked by 2 of 2 filters");
    expect(text(r)).not.toContain("redirected");
    expect(json(r).results[0]?.filters[0]).not.toHaveProperty("intercepted");
    expect(r.completion).toBe("complete");
  });
});

describe("intercepted DNS: every query redirected", () => {
  const run = (target: string) =>
    runCheck(target, {
      dns: redirectedComputer,
      transport: redirectingTransport(),
    });

  test("a blocked name isn't reported as not blocked", async () => {
    const r = await run("bad.example");
    expect(statusOf(r).kind).toBe("intercepted");
    expect(text(r)).toContain(`? ${intercepted}`);
    expect(text(r)).toContain("2 of 2 filters failed the self-test");
    expect(text(r)).toContain(
      "? Security filter  answers don't look like they come from Security filter: DNS may be redirected on this network"
    );
    expect(text(r)).not.toContain("not blocked by");
    expect(isBlocked(r)).toBe(false);
    expect(r.completion).toBe("incomplete");
    expect(exitCode([r])).toBe(exitIncomplete);
  });

  test("JSON marks each filter and the status", async () => {
    const r = await run("bad.example");
    const [out] = json(r).results;
    expect(out?.status).toBe("intercepted");
    expect(out?.filters).toMatchObject([
      { blocked: false, intercepted: true, name: "Security filter" },
      { blocked: false, intercepted: true, name: "Family filter" },
    ]);
  });

  test("a rewritten answer isn't a block by every filter", async () => {
    // The redirector says 0.0.0.0, the real answer, doesn't exist.
    const r = await runCheck("zero.example", {
      dns: Dns.layerStatic({ hosts: { "zero.example": ["0.0.0.0"] } }),
      transport: rewritingTransport,
    });
    expect(r.filters.map((f) => f.outcome)).toMatchObject([
      { verdict: { reason: "nxdomain" } },
      { verdict: { reason: "nxdomain" } },
    ]);
    expect(isBlocked(r)).toBe(false);
    expect(text(r)).toContain(intercepted);
    expect(text(r)).not.toContain("blocked by");
    expect(exitCode([r])).toBe(exitIncomplete);
  });
});

describe("intercepted DNS: one filter redirected", () => {
  // Only queries to the family filter's server are redirected.
  const run = (target: string) =>
    runCheck(target, { transport: redirectingTransport(["198.51.100.53"]) });

  test("a trusted filter's block still counts", async () => {
    const r = await run("bad.example");
    expect(text(r)).toContain("✗ blocked by 1 of 1 filters");
    expect(text(r)).toContain(
      "answers don't look like they come from Family filter"
    );
    expect(text(r)).not.toContain(intercepted);
    expect(exitCode([r])).toBe(exitBlocked);
  });

  test("without a block, the check is incomplete", async () => {
    const r = await run("good.example");
    expect(text(r)).toContain("✓ not blocked by any of 1 filters");
    expect(r.completion).toBe("incomplete");
    expect(exitCode([r])).toBe(exitIncomplete);
  });
});

describe("intercepted DNS: self-tests that get no answer", () => {
  test("a canary with no answer leaves the results as they are", async () => {
    const quiet: Filter[] = fakeFilters.map((f) => ({
      ...f,
      canary: { answers: ["0.0.0.0"], name: "refused.example" },
      servers: f.servers.filter((s) => s !== "198.51.100.53"),
    }));
    const r = await runCheck("good.example", {
      filters: quiet.filter((f) => f.servers.length > 0),
    });
    expect(r.network?.selfTests.map((t) => t.result)).toEqual(["no-answer"]);
    expect(text(r)).toContain("✓ not blocked by any of 1 filters");
    expect(r.completion).toBe("complete");
    expect(exitCode([r])).toBe(0);
  });

  test("Telenor's filters off its network aren't redirected", async () => {
    const telenor: Filter = {
      canary: { answers: ["148.123.15.38"], name: "nettvern.telenor.net" },
      category: "security",
      name: "ISP filter",
      network: "Telenor",
      onlyAnswers: "Telenor customers",
      servers: ["203.0.113.1"],
    };
    const r = await runCheck("good.example", {
      dns: computerWith(publicTestPage),
      filters: [...fakeFilters, telenor],
    });
    expect(text(r)).toContain(
      "? ISP filter       no answer (it only answers Telenor customers)"
    );
    expect(text(r)).toContain("✓ not blocked by any of 2 filters");
    expect(r.completion).toBe("complete");
    expect(exitCode([r])).toBe(0);
  });
});

describe("intercepted DNS: what an untrusted filter is said to do", () => {
  test("a cancelled check says so, not that answers were redirected", async () => {
    const r = await runCheck("bad.example", {
      dns: redirectedComputer,
      transport: redirectingTransport(),
    });
    const cancelled: CheckResult = {
      ...r,
      filters: r.filters.map((f) => ({
        ...f,
        outcome: { error: "cancelled", kind: "failed", ms: 0 },
      })),
    };
    expect(text(cancelled)).not.toContain("don't look like they come from");
  });

  test("this computer's block isn't put down to an untrusted filter", async () => {
    // Both filters answer AdGuard's block page; only the family filter's
    // self-test passes.
    const [security, family] = fakeFilters as [Filter, Filter];
    const r = await runCheck("adult.example", {
      filters: [
        {
          ...security,
          canary: { answers: ["148.123.15.44"], name: "canary.example" },
        },
        family,
      ],
      transport: blockingRedirectTransport,
    });
    expect(r.network?.selfTests.map((t) => t.result)).toEqual([
      "redirected",
      "passed",
    ]);
    const why = r.system && systemWhy(r.system, r);
    expect(why).toContain("same block answer as Family filter");
  });
});

describe("intercepted DNS: filters without a test name", () => {
  test("don't count on a network that seems intercepted", async () => {
    const [security] = fakeFilters as [Filter, Filter];
    const { canary: _, ...untested } = security;
    const r = await runCheck("bad.example", {
      dns: redirectedComputer,
      filters: [...fakeFilters, { ...untested, name: "Untested filter" }],
      transport: redirectingTransport(),
    });
    expect(statusOf(r).kind).toBe("intercepted");
    const filters = json(r).results[0]?.filters ?? [];
    expect(filters.map((f) => f.intercepted)).toEqual([true, true, true]);
    expect(exitCode([r])).toBe(exitIncomplete);
  });

  test("count as usual where DNS isn't intercepted", async () => {
    const [security] = fakeFilters as [Filter, Filter];
    const { canary: _, ...untested } = security;
    const r = await runCheck("bad.example", {
      filters: [...fakeFilters, { ...untested, name: "Untested filter" }],
    });
    expect(text(r)).toContain("✗ blocked by 3 of 3 filters");
  });
});
