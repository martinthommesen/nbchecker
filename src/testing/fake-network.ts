/** A small fake internet for tests: two filters and an unfiltered resolver. */
import { Effect, Layer } from "effect";
import { Dns } from "effect/net";
import type { Category, Filter } from "../check/filters.ts";
import type { CheckerOptions } from "../check/options.ts";
import { Ede, Rcode } from "../dns/codes.ts";
import { QueryError } from "../dns/query-error.ts";
import { DnsTransport } from "../dns/transport.ts";
import type { DnsAnswer, DnsRecord, QueryType } from "../dns/wire.ts";
import { a, aaaa, answer, cname, noRecords } from "./records.ts";

/** A name's records, or a whole answer for one that answers oddly. */
type Zone = Readonly<Record<string, readonly DnsRecord[] | DnsAnswer>>;

const trailingDot = /\.$/;

/** Answers like a resolver serving `zone`: NXDOMAIN for unknown names. */
const lookup = (zone: Zone, name: string, type: QueryType): DnsAnswer => {
  const records = zone[name.replace(trailingDot, "")];
  if (records === undefined) {
    return noRecords(Rcode.nxDomain);
  }
  if ("rcode" in records) {
    return records;
  }
  return answer(records.filter((r) => r.type === type || r.type === "CNAME"));
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
  "newline.example": noRecords(Rcode.noError, {
    code: Ede.blocked,
    text: "policy\n  ✓ Fake  not blocked",
  }),
  // A block said with an Extended DNS Error on a SERVFAIL.
  "policy.example": noRecords(Rcode.servFail, Ede.blocked),
  "refused.example": noRecords(Rcode.refused),
};

const family: Zone = {
  ...real,
  // AdGuard Family's block page.
  "adult.example": [a("adult.example", "94.140.14.35")],
  "bad.example": [a("bad.example", "0.0.0.0")],
  [canaryName]: [a(canaryName, "0.0.0.0")],
};

type Server = Zone | "down" | "servfail";

const byServer: Readonly<Record<string, Server>> = {
  "192.0.2.53": security,
  "198.51.100.53": family,
  "203.0.113.1": "down",
  "203.0.113.2": "servfail",
};

/** An unfiltered resolver that gives the real answer. */
const realAnswerUrl = "https://unfiltered.example/dns-query";
/** An unfiltered resolver that never answers. */
const downRealAnswerUrl = "https://down.example/dns-query";
/** An unfiltered resolver that fails every AAAA query. */
const noAaaaRealAnswerUrl = "https://no-aaaa.example/dns-query";

/** A transport whose servers answer from the zone `zoneOf` gives them. */
const transportWith = (zoneOf: (server: string) => Server | undefined) =>
  Layer.succeed(DnsTransport, {
    ask: (server, name, type) => {
      const zone = zoneOf(server);
      if (zone === undefined || zone === "down") {
        return Effect.fail(new QueryError({ reason: "timed out", server }));
      }
      if (zone === "servfail") {
        return Effect.succeed(noRecords(Rcode.servFail));
      }
      return Effect.succeed(lookup(zone, name, type));
    },
    doh: (url, name, type) => {
      if (url === downRealAnswerUrl) {
        return Effect.fail(
          new QueryError({ reason: "timed out", server: url })
        );
      }
      if (url === noAaaaRealAnswerUrl && type === "AAAA") {
        return Effect.succeed(noRecords(Rcode.servFail));
      }
      return Effect.succeed(lookup(real, name, type));
    },
  });

/** The fake filters' self-test: each blocks `canary.example` its own way. */
const fakeCanary = {
  answers: ["148.123.15.44", "0.0.0.0"],
  name: canaryName,
};

/** A filter on these servers that blocks the fake canary. */
const fakeFilter = (
  category: Category,
  name: string,
  ...servers: readonly string[]
): Filter => ({ canary: fakeCanary, category, name, servers });

/** The first is down; the second blocks with Telenor's Nettvern page. */
const securityServers = ["203.0.113.1", "192.0.2.53"];

const securityFilter = fakeFilter(
  "security",
  "Security filter",
  ...securityServers
);

/** Blocks with 0.0.0.0, and adult sites with AdGuard Family's block page. */
const familyFilter = fakeFilter("family", "Family filter", "198.51.100.53");

export const fakeTransport = transportWith((server) => byServer[server]);

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
    return byServer[server];
  });

/** A resolver the network sends every query to, which blocks names too. */
export const blockingRedirectTransport = transportWith(() => family);

/**
 * Like `redirectingTransport`, with a resolver that also says a name whose
 * real answer is 0.0.0.0 doesn't exist, as some do.
 */
export const rewritingTransport = transportWith(() => ({
  ...real,
  "zero.example": noRecords(Rcode.nxDomain),
}));

export const fakeFilters: readonly Filter[] = [securityFilter, familyFilter];

/** The security filter as if it documented no test name: never self-tested. */
export const untestedSecurityFilter: Filter = {
  category: "security",
  name: "Security filter",
  servers: securityServers,
};

/**
 * A filter that, like Telenor's, only answers on Telenor's network. Its
 * server is down, as Telenor's are to everyone else, and its canary is
 * Telenor's test page with Nettvern's answer.
 */
export const ispFilter: Filter = {
  canary: { answers: ["148.123.15.38"], name: "nettvern.telenor.net" },
  category: "security",
  name: "ISP filter",
  onlyAnswers: { customers: "Telenor customers", network: "Telenor" },
  servers: ["203.0.113.1"],
};

/** What a check asks on the fake network: its filters and real answer. */
export const fakeOptions: CheckerOptions = {
  filters: fakeFilters,
  unfilteredResolvers: [realAnswerUrl],
};

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

/** A computer whose resolver fails every lookup. */
export const failingComputer = Layer.succeed(
  Dns.Dns,
  Dns.make({
    lookup: (hostname) =>
      Effect.fail(
        new Dns.DnsError({
          hostname,
          method: "lookup",
          reason: "ServerFailure",
        })
      ),
  })
);

/** Telenor's test page answer away from Telenor's filters. */
export const publicTestPage = "148.123.15.37";

export {
  downRealAnswerUrl,
  fakeCanary,
  fakeFilter,
  familyFilter,
  noAaaaRealAnswerUrl,
  realAnswerUrl,
  securityFilter,
};
