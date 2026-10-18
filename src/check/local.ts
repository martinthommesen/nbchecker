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
      // A name without a CNAME is normal; any other failure is not.
      Effect.catchIf(
        (error) => error.reason === "NotFound",
        (): Effect.Effect<DnsRecord[]> => Effect.succeed([])
      )
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
