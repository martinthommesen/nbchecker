/** A fake internet shaped like the design's example, for screen tests. */
import { type Duration, Effect, Layer } from "effect";
import { Dns } from "effect/net";
import { type Filter, filters } from "../check/filters.ts";
import { Ede, Rcode } from "../dns/codes.ts";
import { QueryError } from "../dns/query-error.ts";
import { DnsTransport } from "../dns/transport.ts";
import type { DnsAnswer, DnsRecord, QueryType } from "../dns/wire.ts";

const domain = "bad.example";
const realAddress = "203.0.113.42";

const answer = (
  records: readonly DnsRecord[],
  rcode: number = Rcode.noError,
  ede = false
): DnsAnswer => ({
  extendedErrors: [{ code: Ede.blocked, text: "" }].filter(() => ede),
  rcode,
  records,
  truncated: false,
});

const address = (value: string): DnsRecord => ({
  name: domain,
  type: "A",
  value,
});
const cname = (value: string): DnsRecord[] => [
  { name: domain, type: "CNAME", value },
];

const byFilter = new Map<string, DnsAnswer | "down">([
  ["Telenor Nettvern", answer(cname("nettvern-info.telenor.net"))],
  ["Telenor Nettvern+", answer(cname("nettvernpluss-info.telenor.net"))],
  ["Cloudflare Security", answer([address("0.0.0.0")])],
  ["Cloudflare Family", answer([address("0.0.0.0")])],
  ["Quad9", answer([], Rcode.nxDomain)],
  ["OpenDNS FamilyShield", answer([address(realAddress)])],
  ["AdGuard Family", answer([address("0.0.0.0")])],
  ["CleanBrowsing Family", answer([], Rcode.nxDomain, true)],
  ["AdGuard DNS", "down"],
  ["CleanBrowsing Security", answer([], Rcode.nxDomain, true)],
]);

const filterOf = new Map(
  filters.flatMap((f) => f.servers.map((s) => [s, f] as const))
);

/** Each filter blocks its own canary, as on a network that doesn't redirect. */
const canaryAnswer = (f: Filter): DnsAnswer =>
  answer([address(f.canary?.answers[0] ?? "0.0.0.0")]);

const serverAnswer = (server: string, name: string) => {
  const f = filterOf.get(server);
  if (f === undefined) {
    return;
  }
  const a = byFilter.get(f.name);
  if (a !== "down" && name === f.canary?.name) {
    return canaryAnswer(f);
  }
  return a;
};

const realAnswer = (type: QueryType) => {
  if (type === "AAAA") {
    return Effect.succeed(answer([]));
  }
  return Effect.succeed(answer([address(realAddress)]));
};

export const designTransport = Layer.succeed(DnsTransport, {
  ask: (server, name, type) => {
    const a = serverAnswer(server, name);
    if (a === undefined || a === "down") {
      return Effect.fail(new QueryError({ reason: "timed out", server }));
    }
    if (type === "AAAA") {
      return Effect.succeed({
        ...a,
        records: a.records.filter((r) => r.type === "CNAME"),
      });
    }
    return Effect.succeed(a);
  },
  doh: (_url, _name, type) => {
    if (type === "AAAA") {
      return Effect.succeed(answer([]));
    }
    return Effect.succeed(answer([address(realAddress)]));
  },
});

/** The same, with some filters `delay` slow to answer, to show progress. */
export const slowDesignTransportBy = (delay: Duration.Input) =>
  Layer.effect(
    DnsTransport,
    Effect.gen(function* () {
      const fast = yield* DnsTransport;
      const slow = new Set([
        "9.9.9.9",
        "208.67.222.123",
        "94.140.14.14",
        "185.228.168.168",
        "185.228.168.9",
      ]);
      return {
        ask: (server, name, type) => {
          if (slow.has(server)) {
            return Effect.delay(fast.ask(server, name, type), delay);
          }
          return fast.ask(server, name, type);
        },
        doh: fast.doh,
      };
    })
  ).pipe(Layer.provide(designTransport));

export const slowDesignTransport = slowDesignTransportBy("10 seconds");

/**
 * A network that sends every DNS query to an unfiltered resolver, so every
 * filter gives the real answer, its canary included.
 */
export const redirectedDesignTransport = Layer.succeed(DnsTransport, {
  ask: (_server, _name, type) => realAnswer(type),
  doh: (_url, _name, type) => realAnswer(type),
});

export const designComputer = Dns.layerStatic({
  hosts: {
    [domain]: ["0.0.0.0"],
    "nettvern.telenor.net": ["148.123.15.38"],
  },
});

export const blockedName = domain;
