import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { Dns } from "effect/net";
import { QueryError } from "../dns/query-error.ts";
import { DnsTransport } from "../dns/transport.ts";
import {
  type DnsAnswer,
  type DnsRecord,
  type QueryType,
  Rcode,
} from "../dns/wire.ts";
import { CheckerOptions, check } from "./checker.ts";
import type { Filter } from "./filters.ts";
import { status } from "./local.ts";
import { isBlocked } from "./result.ts";

type Zone = Readonly<Record<string, readonly DnsRecord[]>>;

const a = (name: string, value: string): DnsRecord => ({
  name,
  type: "A",
  value,
});
const cname = (name: string, value: string): DnsRecord => ({
  name,
  type: "CNAME",
  value,
});

/** Answers like a resolver serving `zone`: NXDOMAIN for unknown names. */
const lookup = (zone: Zone, name: string, type: QueryType): DnsAnswer => {
  const records = zone[name];
  if (records === undefined) {
    return {
      extendedErrors: [],
      rcode: Rcode.nxDomain,
      records: [],
      truncated: false,
    };
  }
  return {
    extendedErrors: [],
    rcode: Rcode.noError,
    records: records.filter((r) => r.type === type || r.type === "CNAME"),
    truncated: false,
  };
};

const real: Zone = {
  "bad.example": [a("bad.example", "192.0.2.10")],
  "good.example": [a("good.example", "192.0.2.20")],
};

const security: Zone = {
  ...real,
  "bad.example": [
    cname("bad.example", "nettvern-info.telenor.net"),
    a("nettvern-info.telenor.net", "148.123.15.44"),
  ],
};

const family: Zone = { ...real, "bad.example": [a("bad.example", "0.0.0.0")] };

const servers: Readonly<Record<string, Zone | "down" | "servfail">> = {
  "192.0.2.53": security,
  "198.51.100.53": family,
  "203.0.113.1": "down",
  "203.0.113.2": "servfail",
};

const fakeTransport = Layer.succeed(DnsTransport, {
  ask: (server, name, type) => {
    const zone = servers[server];
    if (zone === undefined || zone === "down") {
      return Effect.fail(new QueryError({ reason: "timed out", server }));
    }
    if (zone === "servfail") {
      return Effect.succeed({
        extendedErrors: [],
        rcode: Rcode.servFail,
        records: [],
        truncated: false,
      });
    }
    return Effect.succeed(lookup(zone, name, type));
  },
  doh: (url, name, type) => {
    if (url === "https://down.example/dns-query") {
      return Effect.fail(new QueryError({ reason: "timed out", server: url }));
    }
    return Effect.succeed(lookup(real, name, type));
  },
});

const filters: readonly Filter[] = [
  {
    category: "security",
    name: "Security filter",
    servers: ["203.0.113.1", "192.0.2.53"],
  },
  { category: "family", name: "Family filter", servers: ["198.51.100.53"] },
];

/** This computer sits behind the family filter. */
const computer = Dns.layerStatic({
  hosts: {
    "bad.example": ["0.0.0.0"],
    "good.example": ["192.0.2.20"],
    "host.example": ["192.0.2.99"],
    "nettvern.telenor.net": ["148.123.15.1"],
  },
});

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
        kind: "answered",
        server: "192.0.2.53",
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

test("status reads Telenor's test page", async () => {
  expect(await run(status)).toBe("Telenor Nettvern+");
  const elsewhere = Dns.layerStatic({
    hosts: { "nettvern.telenor.net": ["192.0.2.1"] },
  });
  expect(await status.pipe(Effect.provide(elsewhere), Effect.runPromise)).toBe(
    "none detected"
  );
  expect(
    await status.pipe(Effect.provide(Dns.layerStatic({})), Effect.runPromise)
  ).toBe("unknown");
});
