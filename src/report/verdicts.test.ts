/**
 * Whole checks against the fake network, read the way every output reads
 * them: the text, the screen's summary, JSON and the exit status.
 */
import { describe, expect, test } from "bun:test";
import { Dns } from "effect/net";
import { isBlocked } from "../check/evidence.ts";
import type { Category, Filter } from "../check/filters.ts";
import {
  type CheckResult,
  nameExists,
  realAddresses,
} from "../check/result.ts";
import {
  exitBlocked,
  exitCode,
  exitIncomplete,
  exitNotBlocked,
} from "../cli/exit-status.ts";
import { downRealAnswerUrl, fakeCanary } from "../testing/fake-network.ts";
import { runCheck } from "../testing/run-check.ts";
import { plainText } from "../tui/paint.ts";
import { initialState } from "../tui/state.ts";
import { summaryText } from "../tui/summary.ts";
import { toJson } from "./json.ts";
import { renderText } from "./text.ts";
import { view } from "./view.ts";

const text = (r: CheckResult): string => renderText(view(r), false);

const screen = (r: CheckResult): string =>
  plainText(summaryText({ ...initialState("0.0.0"), result: r }, true));

/** A filter with one server, which blocks the fake canary. */
const fake = (category: Category, name: string, server: string): Filter => ({
  canary: fakeCanary,
  category,
  name,
  servers: [server],
});

const json = (r: CheckResult) => toJson({ dnsFilter: "", version: "" }, [r]);

describe("verdicts: names without an address this computer can use", () => {
  test("an existing name without addresses is not blocked here", async () => {
    const r = await runCheck("mail.example");
    expect(nameExists(r)).toBe(true);
    expect(isBlocked(r)).toBe(false);
    expect(exitCode([r])).toBe(exitNotBlocked);
    expect(text(r)).toContain("– Your DNS         no address on this computer");
    expect(text(r)).toContain("the domain exists, but has no addresses");
    expect(text(r)).not.toContain("doesn't exist");
  });

  test("an IPv6-only name on a computer without IPv6 is not blocked", async () => {
    const r = await runCheck("v6.example");
    expect(isBlocked(r)).toBe(false);
    expect(exitCode([r])).toBe(exitNotBlocked);
  });

  test("no address for a name with an IPv4 address is a block", async () => {
    const r = await runCheck("good.example", {
      dns: Dns.layerStatic({ hosts: {} }),
    });
    expect(r.system).toMatchObject({ verdict: { reason: "no-address" } });
    expect(text(r)).toContain(
      "✗ blocked by your own DNS, but by none of the filters"
    );
    expect(exitCode([r])).toBe(exitBlocked);
  });
});

describe("verdicts: compared with the real answer", () => {
  test("a domain whose own record is 0.0.0.0 is not blocked", async () => {
    const r = await runCheck("zero.example");
    expect(realAddresses(r)).toEqual(["0.0.0.0"]);
    expect(isBlocked(r)).toBe(false);
    expect(text(r)).toContain("✓ not blocked by any of 2 filters");
  });

  test("a filter's NXDOMAIN without the real answer can't be told", async () => {
    const r = await runCheck("nope.example", {
      unfilteredResolvers: [downRealAnswerUrl],
    });
    expect(text(r)).toContain(
      "? couldn't tell: the real answer is unavailable"
    );
    expect(text(r)).toContain("can't tell without the real answer");
    expect(text(r)).not.toContain("not blocked");
    expect(screen(r)).toContain("COULDN'T TELL");
    expect(screen(r)).not.toContain("NOT BLOCKED");
    expect(json(r).results[0]?.status).toBe("cant-tell");
    expect(exitCode([r])).toBe(exitIncomplete);
  });

  test("a name only this computer resolves isn't said not to exist", async () => {
    const r = await runCheck("private.example");
    expect(nameExists(r)).toBe(false);
    expect(text(r)).toContain(
      "– only resolves on this computer (private or split DNS)"
    );
    expect(screen(r)).toContain("only resolves on this computer");
    expect(screen(r)).not.toContain("no resolver found it");
    expect(json(r).results[0]?.status).toBe("local-only");
  });

  test("a name that exists nowhere doesn't exist", async () => {
    const r = await runCheck("nope.example");
    expect(text(r)).toContain("– the domain doesn't exist");
    expect(screen(r)).toContain("DOESN'T EXIST");
    expect(exitCode([r])).toBe(exitNotBlocked);
  });
});

describe("verdicts: block answers", () => {
  test("a SERVFAIL with Extended DNS Error 15 is a block", async () => {
    const r = await runCheck("policy.example");
    expect(r.filters[0]?.outcome).toMatchObject({
      kind: "answered",
      verdict: { detail: "Blocked", reason: "ede" },
    });
    expect(exitCode([r])).toBe(exitBlocked);
  });

  test("a plain REFUSED is a failure, named as such", async () => {
    const refusing = fake("security", "Refusing", "192.0.2.53");
    const r = await runCheck("refused.example", { filters: [refusing] });
    expect(r.filters[0]?.outcome).toMatchObject({
      error: "192.0.2.53: REFUSED",
      kind: "failed",
    });
    expect(text(r)).toContain("no answer → 192.0.2.53: REFUSED");
    expect(exitCode([r])).toBe(exitIncomplete);
  });

  test("AdGuard Family's block page is a block", async () => {
    const r = await runCheck("adult.example");
    expect(r.filters[1]?.outcome).toMatchObject({
      verdict: { reason: "adguard" },
    });
    expect(r.system).toMatchObject({ verdict: { reason: "adguard" } });
    expect(text(r)).toContain("✗ blocked by 1 of 2 filters");
  });

  test("Cisco's inspection proxy is inspected, not blocked", async () => {
    const r = await runCheck("grey.example");
    expect(isBlocked(r)).toBe(false);
    expect(exitCode([r])).toBe(exitNotBlocked);
    expect(text(r)).toContain(
      "! Security filter  sent through Cisco's inspection proxy; the site may still be blocked by URL"
    );
    expect(text(r)).toContain(
      "! not blocked, but 1 of 2 filters send it through Cisco's inspection proxy"
    );
    expect(screen(r)).toContain("INSPECTED");
    const [out] = json(r).results;
    expect(out).toMatchObject({ blocked: false, status: "inspected" });
    expect(out?.filters[0]).toMatchObject({
      blocked: false,
      inspected: true,
      reason: "umbrella-proxy",
    });
  });

  test("blocked by counts only the filters that answered", async () => {
    const r = await runCheck("bad.example", {
      filters: [
        fake("ads", "Down", "203.0.113.1"),
        fake("family", "Family", "198.51.100.53"),
      ],
    });
    expect(text(r)).toContain("✗ blocked by 1 of 1 filters");
    expect(screen(r)).toContain("by 1 of 1 filters");
  });
});

describe("verdicts: text from the network", () => {
  test("can't add lines to the output", async () => {
    const r = await runCheck("newline.example");
    const out = text(r);
    expect(out).toContain("policy�  ✓ Fake  not blocked");
    expect(out).not.toContain("\n  ✓ Fake");
    const narrow = summaryText({ ...initialState("0.0.0"), result: r }, false);
    expect(narrow.chunks.filter((c) => c.text === "\n")).toHaveLength(1);
    expect(plainText(narrow)).not.toContain("\n  ✓");
  });
});
