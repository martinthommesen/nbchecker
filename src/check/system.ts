/** Lookups through this computer's own resolver. */
import { Effect, Result } from "effect";
import { Dns, Host, NetAddress } from "effect/net";
import { Rcode } from "../dns/codes.ts";
import { timeoutAfter } from "../dns/query-error.ts";
import type { DnsAnswer, DnsRecord } from "../dns/wire.ts";

/** The system resolver retries on its own, so it gets longer than a filter. */
const systemTimeout = "5 seconds";
/** The CNAME query only adds to the answer, so it gets less time. */
const cnameTimeout = "2 seconds";
/** Like the forward lookups, the reverse lookup gets a deadline of its own. */
const reverseTimeout = "5 seconds";

const addressRecord =
  (host: string) =>
  (ip: NetAddress.IpAddress): DnsRecord => {
    let type: DnsRecord["type"] = "AAAA";
    if (NetAddress.isIpv4Address(ip)) {
      type = "A";
    }
    return { name: host, type, value: NetAddress.formatIp(ip) };
  };

const timedOut = (method: Dns.DnsError["method"], hostname: string) => () =>
  Effect.fail(new Dns.DnsError({ hostname, method, reason: "Timeout" }));

/** The CNAME records this computer's resolver has for a name, if it can say. */
const cnamesOf = (dns: Dns.Dns["Service"], host: string, shown: string) =>
  dns.resolve(host, "CNAME").pipe(
    Effect.map((rs) =>
      rs.map(
        (r): DnsRecord => ({
          name: shown,
          type: "CNAME",
          value: Host.toRelative(r.target),
        })
      )
    ),
    Effect.timeoutOrElse({
      duration: cnameTimeout,
      orElse: timedOut("resolve", host),
    }),
    Effect.result
  );

/** What stands for this computer's resolver where a server's address would. */
export const systemServer = "this computer";

/** This computer's answer, shaped like a DNS answer so it can be classified. */
export interface SystemAnswer {
  /** Never has an error rcode: the system resolver doesn't report one. */
  readonly answer: DnsAnswer;
  /**
   * The resolver found no address. It can't say whether the name doesn't
   * exist, has no addresses, or only has ones this computer can't use, such
   * as IPv6 addresses on a computer without IPv6.
   */
  readonly noAddress: boolean;
  /** What the answer leaves out, such as a CNAME query that failed. */
  readonly notes: readonly string[];
}

/**
 * Asks this computer's resolver for a name's addresses, the way programs do,
 * and separately for its CNAME, to show block pages. The addresses decide
 * the answer; a failed CNAME query only leaves the CNAME out. `host` is the
 * name as looked up and `shown` the name its records are shown under.
 */
export const lookupSystem = (host: string, shown: string) =>
  Effect.gen(function* () {
    const dns = yield* Dns.Dns;
    const [cnames, addresses] = yield* Effect.all(
      [cnamesOf(dns, host, shown), dns.lookup(host).pipe(Effect.result)],
      { concurrency: "unbounded" }
    );
    if (
      Result.isFailure(addresses) &&
      addresses.failure.reason !== "NotFound"
    ) {
      return yield* Effect.fail(addresses.failure);
    }
    const notes: string[] = [];
    let records: DnsRecord[] = [];
    if (Result.isSuccess(cnames)) {
      records = [...cnames.success];
    } else if (cnames.failure.reason !== "NotFound") {
      // A name without a CNAME is normal; any other failure is not.
      notes.push(`CNAME query failed: ${cnames.failure.message}`);
    }
    if (Result.isSuccess(addresses)) {
      records.push(...addresses.success.map(addressRecord(shown)));
    } else {
      notes.push("no address on this computer");
    }
    return {
      answer: {
        extendedErrors: [],
        rcode: Rcode.noError,
        records,
        truncated: false,
      },
      noAddress: Result.isFailure(addresses),
      notes,
    } satisfies SystemAnswer;
  }).pipe(timeoutAfter(systemTimeout, systemServer));

/** The reverse DNS name of an IP address; undefined when it has none. */
export const reverseName = (ip: string) =>
  Effect.gen(function* () {
    const dns = yield* Dns.Dns;
    const names = yield* dns.reverse(ip).pipe(
      Effect.timeoutOrElse({
        duration: reverseTimeout,
        orElse: timedOut("reverse", ip),
      }),
      Effect.result
    );
    if (Result.isSuccess(names)) {
      return Host.toRelative(names.success[0]);
    }
    if (names.failure.reason === "NotFound") {
      return;
    }
    return yield* Effect.fail(names.failure);
  });
