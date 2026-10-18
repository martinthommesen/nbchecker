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

/** A name's records, or a whole answer for one that answers oddly. */
type Zone = Readonly<Record<string, readonly DnsRecord[] | DnsAnswer>>;

const edeBlocked = 15;

const a = (name: string, value: string): DnsRecord => ({
  name,
  type: "A",
  value,
});
const aaaa = (name: string, value: string): DnsRecord => ({
  name,
  type: "AAAA",
  value,
});
const cname = (name: string, value: string): DnsRecord => ({
  name,
  type: "CNAME",
  value,
});
const failure = (rcode: number, ...edes: readonly number[]): DnsAnswer => ({
  extendedErrors: edes.map((code) => ({ code, text: "" })),
  rcode,
  records: [],
  truncated: false,
});

const trailingDot = /\.$/;

/** Answers like a resolver serving `zone`: NXDOMAIN for unknown names. */
const lookup = (zone: Zone, name: string, type: QueryType): DnsAnswer => {
  const records = zone[name.replace(trailingDot, "")];
  if (records !== undefined && "rcode" in records) {
    return records;
  }
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

/** The name the fake filters document as blocked, for the self-test. */
const canaryName = "canary.example";

const real: Zone = {
  "adult.example": [a("adult.example", "192.0.2.40")],
  "bad.example": [a("bad.example", "192.0.2.10")],
  [canaryName]: [a(canaryName, "192.0.2.5")],
  "good.example": [a("good.example", "192.0.2.20")],
  "grey.example": [a("grey.example", "192.0.2.30")],
  // Exists, but with no address, like a name with only TXT or MX records.
  "mail.example": [],
  // Telenor's test page, as every resolver but Telenor's filters answers it.
  "nettvern.telenor.net": [a("nettvern.telenor.net", "148.123.15.37")],
  "policy.example": [a("policy.example", "192.0.2.50")],
  "refused.example": [a("refused.example", "192.0.2.60")],
  // Only an IPv6 address.
  "v6.example": [aaaa("v6.example", "2001:db8::6")],
  // The domain's own record really is 0.0.0.0, as with wildcard DNS services.
  "zero.example": [a("zero.example", "0.0.0.0")],
};

const security: Zone = {
  ...real,
  "bad.example": [
    cname("bad.example", "nettvern-info.telenor.net"),
    a("nettvern-info.telenor.net", "148.123.15.44"),
  ],
  [canaryName]: [
    cname(canaryName, "nettvern-info.telenor.net"),
    a("nettvern-info.telenor.net", "148.123.15.44"),
  ],
  // Cisco's inspection proxy.
  "grey.example": [a("grey.example", "146.112.56.167")],
  // Telenor's test page, as Nettvern answers it.
  "nettvern.telenor.net": [a("nettvern.telenor.net", "148.123.15.38")],
  // Extended DNS Error text that tries to add a line to the output.
  "newline.example": {
    extendedErrors: [
      { code: edeBlocked, text: "policy\n  ✓ Fake  not blocked" },
    ],
    rcode: Rcode.noError,
    records: [],
    truncated: false,
  },
  // A block said with an Extended DNS Error on a SERVFAIL.
  "policy.example": failure(Rcode.servFail, edeBlocked),
  "refused.example": failure(Rcode.refused),
};

const family: Zone = {
  ...real,
  // AdGuard Family's block page.
  "adult.example": [a("adult.example", "94.140.14.35")],
  "bad.example": [a("bad.example", "0.0.0.0")],
  [canaryName]: [a(canaryName, "0.0.0.0")],
};

type Server = Zone | "down" | "servfail";

const servers: Readonly<Record<string, Server>> = {
  "192.0.2.53": security,
  "198.51.100.53": family,
  "203.0.113.1": "down",
  "203.0.113.2": "servfail",
};

/** A transport whose servers answer from the zone `zoneOf` gives them. */
const transportWith = (zoneOf: (server: string) => Server | undefined) =>
  Layer.succeed(DnsTransport, {
    ask: (server, name, type) => {
      const zone = zoneOf(server);
      if (zone === undefined || zone === "down") {
        return Effect.fail(new QueryError({ reason: "timed out", server }));
      }
      if (zone === "servfail") {
        return Effect.succeed(failure(Rcode.servFail));
      }
      return Effect.succeed(lookup(zone, name, type));
    },
    doh: (url, name, type) => {
      if (url === "https://down.example/dns-query") {
        return Effect.fail(
          new QueryError({ reason: "timed out", server: url })
        );
      }
      if (url === "https://no-aaaa.example/dns-query" && type === "AAAA") {
        return Effect.succeed(failure(Rcode.servFail));
      }
      return Effect.succeed(lookup(real, name, type));
    },
  });

export const fakeTransport = transportWith((server) => servers[server]);

/**
 * A network that sends every DNS query to an unfiltered resolver, whatever
 * server it was sent to, as some hotels, routers and VPNs do. With `only`,
 * just the queries sent to those servers.
 */
export const redirectingTransport = (only?: readonly string[]) =>
  transportWith((server) => {
    if (only === undefined || only.includes(server)) {
      return real;
    }
    return servers[server];
  });

/** The fake filters' self-test: each blocks `canary.example` its own way. */
export const fakeCanary = {
  answers: ["148.123.15.44", "0.0.0.0"],
  name: canaryName,
};

/** A resolver the network sends every query to, which blocks names too. */
export const blockingRedirectTransport = transportWith(() => family);

/**
 * Like `redirectingTransport`, with a resolver that also says a name whose
 * real answer is 0.0.0.0 doesn't exist, as some do.
 */
export const rewritingTransport = transportWith(() => ({
  ...real,
  "zero.example": failure(Rcode.nxDomain),
}));

export const fakeFilters: readonly Filter[] = [
  {
    canary: fakeCanary,
    category: "security",
    name: "Security filter",
    servers: ["203.0.113.1", "192.0.2.53"],
  },
  {
    canary: fakeCanary,
    category: "family",
    name: "Family filter",
    servers: ["198.51.100.53"],
  },
];

/**
 * This computer sits behind the family filter, and has no IPv6. Its DNS
 * gives `testPage` for Telenor's test page: by default Nettvern+'s answer,
 * so it is on Telenor's network.
 */
export const computerWith = (testPage = "148.123.15.1") =>
  Dns.layerStatic({
    hosts: {
      "adult.example": ["94.140.14.35"],
      "bad.example": ["0.0.0.0"],
      "good.example": ["192.0.2.20"],
      "grey.example": ["192.0.2.30"],
      "host.example": ["192.0.2.99"],
      "nettvern.telenor.net": [testPage],
      "policy.example": ["192.0.2.50"],
      // A name only this computer knows, as with split DNS.
      "private.example": ["192.0.2.77"],
      "refused.example": ["192.0.2.60"],
      "zero.example": ["0.0.0.0"],
    },
  });

export const computer = computerWith();

/** Telenor's test page answer away from Telenor's filters. */
export const publicTestPage = "148.123.15.37";
