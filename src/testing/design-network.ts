/** A fake internet shaped like the design's example, for screen tests. */
import { type Duration, Effect, Layer } from "effect";
import { Dns } from "effect/net";
import { type Filter, filters } from "../check/filters.ts";
import { Ede, Rcode } from "../dns/codes.ts";
import { QueryError } from "../dns/query-error.ts";
import { DnsTransport } from "../dns/transport.ts";
import type { DnsAnswer, QueryType } from "../dns/wire.ts";
import { a, answer, cname, noRecords } from "./records.ts";

const domain = "bad.example";
const realAddress = "203.0.113.42";

/** An answer for `domain` with just this address. */
const addressAnswer = (value: string): DnsAnswer => answer([a(domain, value)]);

/** An answer for `domain` with just a CNAME to `target`. */
const cnameAnswer = (target: string): DnsAnswer =>
  answer([cname(domain, target)]);

const byFilter = new Map<string, DnsAnswer | "down">([
  ["Telenor Nettvern", cnameAnswer("nettvern-info.telenor.net")],
  ["Telenor Nettvern+", cnameAnswer("nettvernpluss-info.telenor.net")],
  ["Cloudflare Security", addressAnswer("0.0.0.0")],
  ["Cloudflare Family", addressAnswer("0.0.0.0")],
  ["Quad9", noRecords(Rcode.nxDomain)],
  ["OpenDNS FamilyShield", addressAnswer(realAddress)],
  ["AdGuard Family", addressAnswer("0.0.0.0")],
  ["CleanBrowsing Family", noRecords(Rcode.nxDomain, Ede.blocked)],
  ["AdGuard DNS", "down"],
  ["CleanBrowsing Security", noRecords(Rcode.nxDomain, Ede.blocked)],
]);

const filterOf = new Map(
  filters.flatMap((f) => f.servers.map((s) => [s, f] as const))
);

/** Each filter blocks its own canary, as on a network that doesn't redirect. */
const canaryAnswer = (f: Filter): DnsAnswer =>
  addressAnswer(f.canary?.answers[0] ?? "0.0.0.0");

const serverAnswer = (server: string, name: string) => {
  const f = filterOf.get(server);
  if (f === undefined) {
    return;
  }
  const reply = byFilter.get(f.name);
  if (reply !== "down" && name === f.canary?.name) {
    return canaryAnswer(f);
  }
  return reply;
};

const realAnswer = (type: QueryType) => {
  if (type === "AAAA") {
    return Effect.succeed(answer([]));
  }
  return Effect.succeed(addressAnswer(realAddress));
};

export const designTransport = Layer.succeed(DnsTransport, {
  ask: (server, name, type) => {
    const reply = serverAnswer(server, name);
    if (reply === undefined || reply === "down") {
      return Effect.fail(new QueryError({ reason: "timed out", server }));
    }
    if (type === "AAAA") {
      return Effect.succeed({
        ...reply,
        records: reply.records.filter((r) => r.type === "CNAME"),
      });
    }
    return Effect.succeed(reply);
  },
  doh: (_url, _name, type) => realAnswer(type),
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

/**
 * This computer on the design network: on Telenor's network, behind
 * Nettvern, with its DNS answering `blockedAnswer` for the blocked name.
 */
export const designComputerWith = (blockedAnswer: string) =>
  Dns.layerStatic({
    hosts: {
      [domain]: [blockedAnswer],
      "nettvern.telenor.net": ["148.123.15.38"],
    },
  });

export const designComputer = designComputerWith("0.0.0.0");

export const blockedName = domain;
