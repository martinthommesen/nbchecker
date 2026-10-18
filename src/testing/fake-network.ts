/** A small fake internet for tests: two filters and an unfiltered resolver. */
import { Effect, Layer } from "effect";
import { Dns } from "effect/net";
import type { Filter } from "../check/filters.ts";
import { QueryError } from "../dns/query-error.ts";
import { DnsTransport } from "../dns/transport.ts";
import {
  type DnsAnswer,
  type DnsRecord,
  type QueryType,
  Rcode,
} from "../dns/wire.ts";

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

export const fakeTransport = Layer.succeed(DnsTransport, {
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

export const fakeFilters: readonly Filter[] = [
  {
    category: "security",
    name: "Security filter",
    servers: ["203.0.113.1", "192.0.2.53"],
  },
  { category: "family", name: "Family filter", servers: ["198.51.100.53"] },
];

/** This computer sits behind the family filter. */
export const computer = Dns.layerStatic({
  hosts: {
    "bad.example": ["0.0.0.0"],
    "good.example": ["192.0.2.20"],
    "host.example": ["192.0.2.99"],
    "nettvern.telenor.net": ["148.123.15.1"],
  },
});
