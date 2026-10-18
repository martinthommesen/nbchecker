/**
 * Works out from a resolver's answer whether, and why, a name is blocked.
 */
import { Result } from "effect";
import { NetAddress } from "effect/net";
import { type DnsAnswer, Rcode } from "../dns/wire.ts";

/** Telenor answers a blocked name with a CNAME to one of these hosts. */
const telenorTargets = new Map<string, Reason>([
  ["dns-block.telenor.net", "legal"],
  ["kid.telenor.net", "kripos"],
  ["nettvern-info.telenor.net", "nettvern"],
  ["nettvernpluss-info.telenor.net", "nettvern+"],
]);

/** Cisco Umbrella block-page addresses and what each one means. */
const umbrellaBlockPages = new Map<string, string>([
  ["146.112.61.104", "domain list"],
  ["146.112.61.105", "command and control"],
  ["146.112.61.106", "content category"],
  ["146.112.61.107", "malware"],
  ["146.112.61.108", "phishing"],
  ["146.112.61.109", "blocked"],
  ["146.112.61.110", "security"],
]);

const umbrellaProxyPrefix = "146.112.56.";

/** Extended DNS Error codes (RFC 8914) that mean the name was blocked. */
const edeBlocked = 15;
const edeCensored = 16;
const edeFiltered = 17;
const blockingErrors = new Map<number, string>([
  [edeBlocked, "Blocked"],
  [edeCensored, "Censored"],
  [edeFiltered, "Filtered"],
]);

/** The first 12 bytes of an IPv4-mapped IPv6 address, ::ffff:a.b.c.d. */
const ff = 0xff;
const ipv4MappedPrefix = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ff, ff];

const isUnspecified = (address: string): boolean =>
  address === "0.0.0.0" || address === "::";

interface Draft {
  answers: string[];
  blocked: boolean;
  detail: string;
  missing: boolean;
  reason: Reason | undefined;
}

const block = (v: Draft, reason: Reason, detail = ""): void => {
  if (!v.blocked) {
    v.blocked = true;
    v.reason = reason;
    v.detail = detail;
  }
};

const addAddress = (v: Draft, raw: string): void => {
  const address = canonicalAddress(raw);
  v.answers.push(address);
  const category = umbrellaBlockPages.get(address);
  if (isUnspecified(address)) {
    block(v, "null-ip");
  } else if (category !== undefined) {
    block(v, "umbrella", category);
  } else if (address.startsWith(umbrellaProxyPrefix)) {
    block(v, "umbrella-proxy");
  }
};

const reasonText: Record<Reason, string> = {
  ede: "blocked",
  kripos: "blocked by the Kripos child-abuse filter",
  legal: "blocked by Telenor on legal grounds, for every Telenor customer",
  nettvern: "blocked by Nettvern",
  "nettvern+": "blocked by Nettvern+",
  "null-ip": "blocked: answers 0.0.0.0",
  nxdomain: "blocked: says the domain doesn't exist",
  umbrella: "blocked by Cisco Umbrella",
  "umbrella-proxy": "sent through Cisco Umbrella's inspection proxy",
};

export type Reason =
  | "ede" // Extended DNS Error: Blocked, Censored or Filtered
  | "kripos" // kid.telenor.net stop page
  | "legal" // CNAME dns-block.telenor.net (court order or regulator)
  | "nettvern" // CNAME nettvern-info.telenor.net
  | "nettvern+" // CNAME nettvernpluss-info.telenor.net
  | "null-ip" // answered 0.0.0.0 or :: (Cloudflare, AdGuard)
  | "nxdomain" // says the name doesn't exist, but it does
  | "umbrella" // Cisco Umbrella block page
  | "umbrella-proxy"; // Cisco Umbrella inspection proxy, i.e. greylisted

/** What one resolver's answer means for one name. */
export interface Verdict {
  /** Addresses and CNAME targets, for display. */
  readonly answers: readonly string[];
  readonly blocked: boolean;
  /** For example the Umbrella category or the EDE text. */
  readonly detail: string;
  /** The resolver said the name doesn't exist. */
  readonly missing: boolean;
  readonly reason: Reason | undefined;
}

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

/**
 * Reads a resolver's answer. `truthExists` says whether an unfiltered
 * resolver found the name, so a filter's NXDOMAIN can be told apart from a
 * name that simply doesn't exist.
 */
export const classify = (answer: DnsAnswer, truthExists: boolean): Verdict => {
  const v: Draft = {
    answers: [],
    blocked: false,
    detail: "",
    missing: false,
    reason: undefined,
  };
  for (const e of answer.extendedErrors) {
    const name = blockingErrors.get(e.code);
    if (name !== undefined) {
      block(v, "ede", [name, e.text].filter(Boolean).join(": "));
    }
  }
  for (const r of answer.records) {
    if (r.type === "CNAME") {
      v.answers.push(r.value);
      const reason = telenorTargets.get(r.value);
      if (reason !== undefined) {
        block(v, reason);
      }
    } else {
      addAddress(v, r.value);
    }
  }
  if (answer.rcode === Rcode.nxDomain) {
    v.missing = true;
    if (truthExists) {
      block(v, "nxdomain");
    }
  }
  return v;
};

/** Combines the verdicts for the A and AAAA answers. */
export const merge = (...verdicts: readonly Verdict[]): Verdict => {
  const blocking = verdicts.find((v) => v.blocked);
  return {
    answers: [...new Set(verdicts.flatMap((v) => v.answers))],
    blocked: blocking !== undefined,
    detail: blocking?.detail ?? "",
    missing: verdicts.length > 0 && verdicts.every((v) => v.missing),
    reason: blocking?.reason,
  };
};

/** Says what a verdict means, in a phrase for people. */
export const describe = (v: Verdict): string => {
  if (v.reason === undefined) {
    if (v.missing) {
      return "not found (the domain doesn't exist)";
    }
    return "not blocked";
  }
  const text = reasonText[v.reason];
  if (v.detail === "") {
    return text;
  }
  return `${text} (${v.detail})`;
};
