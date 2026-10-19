import { describe, expect, test } from "bun:test";
import { Effect, Fiber, Layer, Result } from "effect";
import { Dns, NetAddress } from "effect/net";
import { TestClock } from "effect/testing";
import {
  downRealAnswerUrl,
  fakeFilter,
  fakeFilters,
  noAaaaRealAnswerUrl,
  realAnswerUrl,
} from "../testing/fake-network.ts";
import {
  checkOnFakeNetwork,
  progressOf,
  runCheck,
} from "../testing/run-check.ts";
import { isBlocked } from "./evidence.ts";
import { nameExists, realAddresses } from "./result.ts";

/** This computer's resolver, doing what `impl` says. */
const resolver = (impl: Parameters<typeof Dns.make>[0]) =>
  Layer.succeed(Dns.Dns, Dns.make(impl));

const verdicts = (r: {
  readonly filters: readonly { readonly outcome: unknown }[];
}) => r.filters.map((f) => f.outcome);

describe("check: names", () => {
  test("a name no filter blocks", async () => {
    const r = await runCheck("https://good.example/page");
    expect(r.host).toBe("good.example");
    expect(nameExists(r)).toBe(true);
    expect(realAddresses(r)).toEqual(["192.0.2.20"]);
    expect(isBlocked(r)).toBe(false);
  });

  test("blocks are read per filter, using the first server that answers", async () => {
    const r = await runCheck("bad.example");
    expect(verdicts(r)).toMatchObject([
      {
        exchange: { server: "192.0.2.53" },
        kind: "answered",
        verdict: { reason: "nettvern" },
      },
      { kind: "answered", verdict: { reason: "null-ip" } },
    ]);
    expect(r.system).toMatchObject({ verdict: { reason: "null-ip" } });
    expect(isBlocked(r)).toBe(true);
  });

  test("a URL is checked for the host a browser would open", async () => {
    const r = await runCheck("https://good.example\\@bad.example/");
    expect(r.host).toBe("good.example");
    expect(isBlocked(r)).toBe(false);
  });

  test("a trailing dot is kept for this computer's lookup only", async () => {
    const asked: string[] = [];
    const address = Result.getOrThrow(NetAddress.ipFromString("192.0.2.20"));
    const recording = resolver({
      lookup: (host) =>
        Effect.sync(() => {
          asked.push(host);
          return [address];
        }),
    });
    const r = await runCheck("good.example.", { dns: recording });
    expect(r.host).toBe("good.example");
    expect(nameExists(r)).toBe(true);
    expect(asked).toContain("good.example.");
  });

  test("a name that doesn't exist anywhere is not a block", async () => {
    const r = await runCheck("nope.example");
    expect(nameExists(r)).toBe(false);
    expect(isBlocked(r)).toBe(false);
    expect(verdicts(r)).toMatchObject([
      { verdict: { missing: true } },
      { verdict: { missing: true } },
    ]);
  });
});

describe("check: failures", () => {
  test("a filter whose servers all fail is reported as failed", async () => {
    const r = await runCheck("good.example", {
      filters: [fakeFilter("ads", "Broken", "203.0.113.1", "203.0.113.2")],
    });
    expect(r.filters[0]?.outcome.kind).toBe("failed");
  });

  test("falls back to the next unfiltered resolver", async () => {
    const r = await runCheck("good.example", {
      unfilteredResolvers: [downRealAnswerUrl, realAnswerUrl],
    });
    expect(r.realAnswer).toMatchObject({ exists: true, kind: "answered" });
  });

  test("a resolver that fails the AAAA query is skipped", async () => {
    const r = await runCheck("good.example", {
      unfilteredResolvers: [noAaaaRealAnswerUrl, realAnswerUrl],
    });
    expect(r.realAnswer).toMatchObject({
      exchange: { server: realAnswerUrl },
    });
  });

  test("reports when no unfiltered resolver answers", async () => {
    const r = await runCheck("good.example", {
      unfilteredResolvers: [downRealAnswerUrl],
    });
    expect(r.realAnswer).toMatchObject({
      error: expect.stringContaining("timed out"),
      kind: "failed",
    });
  });
});

describe("check: IP addresses", () => {
  test("an IP address is checked by its reverse name", async () => {
    const r = await runCheck("192.0.2.99");
    expect(r.isIp).toBe(true);
    expect(r.host).toBe("host.example");
    expect(r.checked).toBe(true);
  });

  test("an IP address without a reverse name is not checked", async () => {
    const r = await runCheck("192.0.2.98");
    expect(r.checked).toBe(false);
    expect(r.lookupError).toBeUndefined();
  });

  test("a failed reverse lookup is an error", async () => {
    const failing = resolver({
      lookup: () => Effect.succeed([]),
      reverse: (address) =>
        Effect.fail(
          new Dns.DnsError({
            hostname: String(address),
            method: "reverse",
            reason: "ServerFailure",
          })
        ),
    });
    const r = await runCheck("192.0.2.98", { dns: failing });
    expect(r.checked).toBe(false);
    expect(r.lookupError).toBeDefined();
  });

  test("a reverse lookup that never ends times out", async () => {
    const stuck = resolver({
      lookup: () => Effect.succeed([]),
      reverse: () => Effect.never,
    });
    const r = await Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        checkOnFakeNetwork("192.0.2.98", { dns: stuck })
      );
      yield* TestClock.adjust("5 seconds");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer()), Effect.runPromise);
    expect(r.lookupError).toContain("Timeout");
    expect(r.completion).toBe("incomplete");
  });

  test("an invalid target is an error", async () => {
    const r = await runCheck("not a name!");
    expect(r.lookupError).toContain("not a domain");
  });
});

describe("check: this computer", () => {
  test("a failed CNAME query doesn't hide this computer's address", async () => {
    const address = Result.getOrThrow(NetAddress.ipFromString("192.0.2.1"));
    const flaky = resolver({
      lookup: () => Effect.succeed([address]),
      resolve: (name, type) =>
        Effect.fail(
          new Dns.DnsError({
            hostname: String(name),
            method: "resolve",
            reason: "ServerFailure",
            recordType: type,
          })
        ),
    });
    const r = await runCheck("good.example", { dns: flaky });
    expect(r.system).toMatchObject({
      exchange: { notes: [expect.stringContaining("CNAME query failed")] },
      kind: "answered",
      verdict: { answers: ["192.0.2.1"], blocked: false },
    });
  });
});

describe("check: progress", () => {
  test("reports each answer as it arrives, starting with none", async () => {
    const { reports, result } = await progressOf("bad.example");
    // One report before any answer, then one per filter, this computer and
    // the real answer, and one when the network is known.
    const expected =
      fakeFilters.length + ["start", "system", "real answer", "network"].length;
    expect(reports).toHaveLength(expected);
    expect(reports[0]?.filters.every((f) => f.outcome.kind === "pending")).toBe(
      true
    );
    expect(reports.at(-1)).toEqual(result);
  });
});
