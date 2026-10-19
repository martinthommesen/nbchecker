/** The addresses in DNS answers, written so they can be compared. */
import { Result } from "effect";
import { NetAddress } from "effect/net";
import type { DnsAnswer } from "../dns/wire.ts";

/** The first 12 bytes of an IPv4-mapped IPv6 address, ::ffff:a.b.c.d. */
const ff = 0xff;
const ipv4MappedPrefix = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ff, ff];

/**
 * Formats an address the same way whichever way it was written, turning
 * IPv4-mapped IPv6 addresses back into IPv4.
 */
export const canonicalAddress = (s: string): string => {
  const parsed = NetAddress.ipFromString(s);
  if (Result.isFailure(parsed)) {
    return s;
  }
  const ip = parsed.success;
  if (NetAddress.isIpv6Address(ip)) {
    const octets = NetAddress.ipv6ToOctets(ip);
    if (ipv4MappedPrefix.every((b, i) => octets[i] === b)) {
      return octets.slice(ipv4MappedPrefix.length).join(".");
    }
  }
  return NetAddress.formatIp(ip);
};

/** Whether an address is IPv4, which every computer can use. */
export const isIpv4 = (address: string): boolean => !address.includes(":");

/**
 * The addresses some answers give, in order. A CNAME, such as to Telenor's
 * warning page, only leads to an address, so it is left out.
 */
export const addressesIn = (answers: readonly DnsAnswer[]): string[] =>
  answers
    .flatMap((a) => a.records)
    .filter((r) => r.type !== "CNAME")
    .map((r) => r.value);
