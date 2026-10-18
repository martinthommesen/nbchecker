/** Lookups through this computer's own resolver. */
import { Effect, Result } from "effect";
import { Dns, Host, NetAddress } from "effect/net";
import { type DnsAnswer, type DnsRecord, Rcode } from "../dns/wire.ts";
import { type CheckResult, unchecked } from "./result.ts";

const ipNote =
  "DNS filters block names, not IP addresses, so an IP address you connect to directly is not blocked by them.";

const answerOf = (rcode: number, records: readonly DnsRecord[]): DnsAnswer => ({
  extendedErrors: [],
  rcode,
  records,
  truncated: false,
});

const addressRecord =
  (host: string) =>
  (ip: NetAddress.IpAddress): DnsRecord => {
    let type: DnsRecord["type"] = "AAAA";
    if (NetAddress.isIpv4Address(ip)) {
      type = "A";
    }
    return { name: host, type, value: NetAddress.formatIp(ip) };
  };

/** Telenor answers its test page with a different address per filter. */
const statusPages = new Map<string, string>([
  ["148.123.15.1", "Telenor Nettvern+"],
  ["148.123.15.37", "none (Telenor DNS without a filter)"],
  ["148.123.15.38", "Telenor Nettvern"],
]);

/** This computer's answer, shaped like a DNS answer so it can be classified. */
export const lookupSystem = (host: string) =>
  Effect.gen(function* () {
    const dns = yield* Dns.Dns;
    const cnames = yield* dns.resolve(host, "CNAME").pipe(
      Effect.map((rs) =>
        rs.map(
          (r): DnsRecord => ({
            name: host,
            type: "CNAME",
            value: Host.toRelative(r.target),
          })
        )
      ),
      Effect.orElseSucceed((): DnsRecord[] => [])
    );
    const addresses = yield* dns.lookup(host).pipe(Effect.result);
    if (Result.isSuccess(addresses)) {
      const records = addresses.success.map(addressRecord(host));
      return answerOf(Rcode.noError, [...cnames, ...records]);
    }
    if (addresses.failure.reason === "NotFound") {
      return answerOf(Rcode.nxDomain, cnames);
    }
    return yield* Effect.fail(addresses.failure);
  });

/** Finds the name to check for an IP address: its reverse DNS name. */
export const reverseName = (target: string, ip: string) =>
  Effect.gen(function* () {
    const dns = yield* Dns.Dns;
    const base = unchecked(target, ip, true);
    const names = yield* dns.reverse(ip).pipe(Effect.result);
    if (Result.isSuccess(names)) {
      const name = Host.toRelative(names.success[0]);
      return {
        ...base,
        host: name,
        notes: [ipNote, `Checking its reverse DNS name ${name} instead.`],
      } satisfies CheckResult;
    }
    if (names.failure.reason === "NotFound") {
      return {
        ...base,
        notes: [
          ipNote,
          "The address has no reverse DNS name, so there is nothing else to check.",
        ],
      } satisfies CheckResult;
    }
    const error = names.failure.message;
    return {
      ...base,
      lookupError: error,
      notes: [ipNote, `Could not look up its reverse DNS name: ${error}`],
    } satisfies CheckResult;
  });

/**
 * Says which known filter, if any, this computer's DNS goes through. Only
 * Telenor publishes a test page for this so far.
 */
export const status = Effect.gen(function* () {
  const dns = yield* Dns.Dns;
  const addresses = yield* dns
    .lookup("nettvern.telenor.net")
    .pipe(Effect.timeout("5 seconds"), Effect.result);
  if (Result.isFailure(addresses)) {
    return "unknown";
  }
  for (const ip of addresses.success) {
    const name = statusPages.get(NetAddress.formatIp(ip));
    if (name !== undefined) {
      return name;
    }
  }
  return "none detected";
});
