import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { Dns } from "effect/net";
import type { DnsTransport } from "../dns/transport.ts";
import {
  computer,
  fakeTransport,
  fakeFilters as filters,
} from "../testing/fake-network.ts";
import { CheckerOptions, check } from "./checker.ts";
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
    const r = await run(check("https://good.example/page"));
    expect(r.host).toBe("good.example");
    expect(r.exists).toBe(true);
    expect(r.truth).toEqual(["192.0.2.20"]);
    expect(isBlocked(r)).toBe(false);
  });

  test("blocks are read per filter, using the first server that answers", async () => {
    const r = await run(check("bad.example"));
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

  test("a name that doesn't exist anywhere is not a block", async () => {
    const r = await run(check("nope.example"));
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
    const r = await run(check("good.example"), {
      filters: [
        {
          category: "ads",
          name: "Broken",
          servers: ["203.0.113.1", "203.0.113.2"],
        },
      ],
    });
    expect(r.filters[0]?.outcome.kind).toBe("failed");
  });

  test("falls back to the next unfiltered resolver", async () => {
    const r = await run(check("good.example"), {
      truthUrls: [
        "https://down.example/dns-query",
        "https://truth.example/dns-query",
      ],
    });
    expect(r.truthError).toBeUndefined();
    expect(r.exists).toBe(true);
  });

  test("reports when no unfiltered resolver answers", async () => {
    const r = await run(check("good.example"), {
      truthUrls: ["https://down.example/dns-query"],
    });
    expect(r.truthError).toContain("timed out");
  });
});

describe("check: IP addresses", () => {
  test("an IP address is checked by its reverse name", async () => {
    const r = await run(check("192.0.2.99"));
    expect(r.isIp).toBe(true);
    expect(r.host).toBe("host.example");
    expect(r.checked).toBe(true);
  });

  test("an IP address without a reverse name is not checked", async () => {
    const r = await run(check("192.0.2.98"));
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
    const r = await check("192.0.2.98").pipe(
      Effect.provideService(Dns.Dns, failing),
      Effect.provide(fakeTransport),
      Effect.runPromise
    );
    expect(r.checked).toBe(false);
    expect(r.lookupError).toBeDefined();
  });

  test("an invalid target is an error", async () => {
    const r = await run(check("not a name!"));
    expect(r.lookupError).toContain("not a domain");
  });
});

describe("check: progress", () => {
  test("reports each answer as it arrives, starting with none", async () => {
    const seen: CheckResult[] = [];
    const r = await run(
      check("bad.example").pipe(
        Effect.provideService(Progress, (sofar) =>
          Effect.sync(() => {
            seen.push(sofar);
          })
        )
      )
    );
    // One report before any answer, then one per filter, system and truth.
    const reports = filters.length + ["start", "system", "truth"].length;
    expect(seen).toHaveLength(reports);
    expect(seen[0]?.filters.every((f) => f.outcome.kind === "pending")).toBe(
      true
    );
    expect(seen.at(-1)).toEqual(r);
    expect(r.truthExchange).toMatchObject({ transport: "HTTPS 443" });
  });
});
