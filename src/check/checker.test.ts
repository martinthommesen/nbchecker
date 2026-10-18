import { describe, expect, test } from "bun:test";
import { Effect, Fiber, Layer, Result } from "effect";
import { Dns, NetAddress } from "effect/net";
import { TestClock } from "effect/testing";
import type { DnsTransport } from "../dns/transport.ts";
import {
  computer,
  fakeCanary,
  fakeTransport,
  fakeFilters as filters,
} from "../testing/fake-network.ts";
import { CheckerOptions, check } from "./checker.ts";
import { detectNetwork } from "./network.ts";
import { Progress } from "./progress.ts";
import { type CheckResult, isBlocked } from "./result.ts";

const run = <A, E>(
  effect: Effect.Effect<A, E, Dns.Dns | DnsTransport>,
  options: Partial<CheckerOptions> = {}
) =>
  effect.pipe(
    Effect.provideService(CheckerOptions, {
      filters,
      truthUrls: ["https://truth.example/dns-query"],
      ...options,
    }),
    Effect.provide(Layer.merge(fakeTransport, computer)),
    Effect.runPromise
  );

const verdicts = (r: {
  readonly filters: readonly { readonly outcome: unknown }[];
}) => r.filters.map((f) => f.outcome);

describe("check: names", () => {
  test("a name no filter blocks", async () => {
    const r = await run(check("https://good.example/page", detectNetwork));
    expect(r.host).toBe("good.example");
    expect(r.exists).toBe(true);
    expect(r.truth).toEqual(["192.0.2.20"]);
    expect(isBlocked(r)).toBe(false);
  });

  test("blocks are read per filter, using the first server that answers", async () => {
    const r = await run(check("bad.example", detectNetwork));
    expect(verdicts(r)).toMatchObject([
      {
        exchange: { server: "192.0.2.53", transport: "UDP 53" },
        kind: "answered",
        verdict: { reason: "nettvern" },
      },
      { kind: "answered", verdict: { reason: "null-ip" } },
    ]);
    expect(r.system).toMatchObject({ verdict: { reason: "null-ip" } });
    expect(isBlocked(r)).toBe(true);
  });

  test("a URL is checked for the host a browser would open", async () => {
    const r = await run(
      check("https://good.example\\@bad.example/", detectNetwork)
    );
    expect(r.host).toBe("good.example");
    expect(isBlocked(r)).toBe(false);
  });

  test("a trailing dot is kept for this computer's lookup only", async () => {
    const asked: string[] = [];
    const address = Result.getOrThrow(NetAddress.ipFromString("192.0.2.20"));
    const recording = Dns.make({
      lookup: (host) =>
        Effect.sync(() => {
          asked.push(host);
          return [address];
        }),
    });
    const r = await check("good.example.", detectNetwork).pipe(
      Effect.provideService(CheckerOptions, {
        filters,
        truthUrls: ["https://truth.example/dns-query"],
      }),
      Effect.provideService(Dns.Dns, recording),
      Effect.provide(fakeTransport),
      Effect.runPromise
    );
    expect(r.host).toBe("good.example");
    expect(r.exists).toBe(true);
    expect(asked).toContain("good.example.");
  });

  test("a name that doesn't exist anywhere is not a block", async () => {
    const r = await run(check("nope.example", detectNetwork));
    expect(r.exists).toBe(false);
    expect(isBlocked(r)).toBe(false);
    expect(verdicts(r)).toMatchObject([
      { verdict: { missing: true } },
      { verdict: { missing: true } },
    ]);
  });
});

describe("check: failures", () => {
  test("a filter whose servers all fail is reported as failed", async () => {
    const r = await run(check("good.example", detectNetwork), {
      filters: [
        {
          canary: fakeCanary,
          category: "ads",
          name: "Broken",
          servers: ["203.0.113.1", "203.0.113.2"],
        },
      ],
    });
    expect(r.filters[0]?.outcome.kind).toBe("failed");
  });

  test("falls back to the next unfiltered resolver", async () => {
    const r = await run(check("good.example", detectNetwork), {
      truthUrls: [
        "https://down.example/dns-query",
        "https://truth.example/dns-query",
      ],
    });
    expect(r.truthError).toBeUndefined();
    expect(r.exists).toBe(true);
  });

  test("a resolver that fails the AAAA query is skipped", async () => {
    const r = await run(check("good.example", detectNetwork), {
      truthUrls: [
        "https://no-aaaa.example/dns-query",
        "https://truth.example/dns-query",
      ],
    });
    expect(r.truthExchange?.server).toBe("https://truth.example/dns-query");
  });

  test("reports when no unfiltered resolver answers", async () => {
    const r = await run(check("good.example", detectNetwork), {
      truthUrls: ["https://down.example/dns-query"],
    });
    expect(r.truthError).toContain("timed out");
  });
});

describe("check: IP addresses", () => {
  test("an IP address is checked by its reverse name", async () => {
    const r = await run(check("192.0.2.99", detectNetwork));
    expect(r.isIp).toBe(true);
    expect(r.host).toBe("host.example");
    expect(r.checked).toBe(true);
  });

  test("an IP address without a reverse name is not checked", async () => {
    const r = await run(check("192.0.2.98", detectNetwork));
    expect(r.checked).toBe(false);
    expect(r.lookupError).toBeUndefined();
  });

  test("a failed reverse lookup is an error", async () => {
    const failing = Dns.make({
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
    const r = await check("192.0.2.98", detectNetwork).pipe(
      Effect.provideService(Dns.Dns, failing),
      Effect.provide(fakeTransport),
      Effect.runPromise
    );
    expect(r.checked).toBe(false);
    expect(r.lookupError).toBeDefined();
  });

  test("a reverse lookup that never ends times out", async () => {
    const stuck = Dns.make({
      lookup: () => Effect.succeed([]),
      reverse: () => Effect.never,
    });
    const r = await Effect.gen(function* () {
      const fiber = yield* check("192.0.2.98", detectNetwork).pipe(
        Effect.provideService(Dns.Dns, stuck),
        Effect.provide(fakeTransport),
        Effect.forkChild
      );
      yield* TestClock.adjust("5 seconds");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer()), Effect.runPromise);
    expect(r.lookupError).toContain("Timeout");
    expect(r.completion).toBe("incomplete");
  });

  test("an invalid target is an error", async () => {
    const r = await run(check("not a name!", detectNetwork));
    expect(r.lookupError).toContain("not a domain");
  });
});

describe("check: this computer", () => {
  test("a failed CNAME query doesn't hide this computer's address", async () => {
    const address = Result.getOrThrow(NetAddress.ipFromString("192.0.2.1"));
    const flaky = Dns.make({
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
    const r = await check("good.example", detectNetwork).pipe(
      Effect.provideService(Dns.Dns, flaky),
      Effect.provide(fakeTransport),
      Effect.runPromise
    );
    expect(r.system).toMatchObject({
      exchange: { notes: [expect.stringContaining("CNAME query failed")] },
      kind: "answered",
      verdict: { answers: ["192.0.2.1"], blocked: false },
    });
  });
});

describe("check: progress", () => {
  test("reports each answer as it arrives, starting with none", async () => {
    const seen: CheckResult[] = [];
    const r = await run(
      check("bad.example", detectNetwork).pipe(
        Effect.provideService(Progress, (sofar) =>
          Effect.sync(() => {
            seen.push(sofar);
          })
        )
      )
    );
    // One report before any answer, then one per filter, system and truth,
    // and one when the network is known.
    const reports =
      filters.length + ["start", "system", "truth", "network"].length;
    expect(seen).toHaveLength(reports);
    expect(seen[0]?.filters.every((f) => f.outcome.kind === "pending")).toBe(
      true
    );
    expect(seen.at(-1)).toEqual(r);
    expect(r.truthExchange).toMatchObject({ transport: "HTTPS 443" });
  });
});
