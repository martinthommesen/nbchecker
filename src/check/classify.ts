/**
 * Works out from a resolver's answer whether, and why, a name is blocked.
 */
import { Ede, extendedErrorName, Rcode } from "../dns/codes.ts";
import type { DnsAnswer } from "../dns/wire.ts";
import { canonicalAddress, isIpv4 } from "./address.ts";
import {
  adguardBlockPages,
  nullAddresses,
  telenorBlockCnames,
  umbrellaBlockPages,
  umbrellaProxyPrefix,
} from "./known-answers.ts";

/**
 * The Extended DNS Errors that mean the name was blocked. Prohibited is left
 * out: a resolver says it to a client it won't serve at all.
 */
const blockingCodes: ReadonlySet<number> = new Set([
  Ede.blocked,
  Ede.censored,
  Ede.filtered,
]);

/** Whether an Extended DNS Error says the name was blocked. */
const isBlockingError = (code: number): boolean => blockingCodes.has(code);

interface Draft {
  answers: string[];
  blocked: boolean;
  detail: string;
  inspected: boolean;
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

const addAddress = (v: Draft, raw: string, real: ReadonlySet<string>): void => {
  const address = canonicalAddress(raw);
  v.answers.push(address);
  // The domain's own record is never a block, even when it is 0.0.0.0.
  if (real.has(address)) {
    return;
  }
  const category = umbrellaBlockPages.get(address);
  if (nullAddresses.includes(address)) {
    block(v, "null-ip");
  } else if (category !== undefined) {
    block(v, "umbrella", category);
  } else if (adguardBlockPages.has(address)) {
    block(v, "adguard");
  } else if (address.startsWith(umbrellaProxyPrefix)) {
    v.inspected = true;
  }
};

const reasonText: Record<Reason, string> = {
  adguard: "blocked: points to AdGuard's block page",
  ede: "blocked with an Extended DNS Error",
  kripos: "blocked by the Kripos child-abuse filter",
  legal: "blocked by Telenor on legal grounds, for every Telenor customer",
  nettvern: "blocked by Nettvern",
  "nettvern+": "blocked by Nettvern+",
  "no-address":
    "blocked: no address on this computer, though the domain has one",
  "null-ip": "blocked: answers 0.0.0.0",
  nxdomain: "blocked: says the domain doesn't exist",
  umbrella: "blocked by Cisco Umbrella",
  "umbrella-proxy":
    "sent through Cisco's inspection proxy; the site may still be blocked by URL",
};

export type Reason =
  | "adguard" // AdGuard Family's block page
  | "ede" // Extended DNS Error: Blocked, Censored or Filtered
  | "kripos" // kid.telenor.net stop page
  | "legal" // CNAME dns-block.telenor.net (court order or regulator)
  | "nettvern" // CNAME nettvern-info.telenor.net
  | "nettvern+" // CNAME nettvernpluss-info.telenor.net
  | "no-address" // this computer finds no address, but the real answer has one
  | "null-ip" // answered 0.0.0.0 or :: (Cloudflare, AdGuard)
  | "nxdomain" // says the name doesn't exist, but it does
  | "umbrella" // Cisco Umbrella block page
  | "umbrella-proxy"; // Cisco Umbrella inspection proxy: not a block

/** What one resolver's answer means for one name. */
export interface Verdict {
  /** Addresses and CNAME targets, for display. */
  readonly answers: readonly string[];
  readonly blocked: boolean;
  /** For example the Umbrella category or the EDE text. */
  readonly detail: string;
  /**
   * Not blocked, but sent through a proxy that inspects the pages, which
   * may still block some of them.
   */
  readonly inspected: boolean;
  /** The resolver said the name doesn't exist. */
  readonly missing: boolean;
  /** Why it is blocked or inspected; undefined when it is neither. */
  readonly reason: Reason | undefined;
}

/** What the unfiltered resolver says, to compare an answer with. */
export interface Reference {
  /** The addresses it gave. */
  readonly addresses: readonly string[];
  /** It found the name. */
  readonly exists: boolean;
}

/** Nothing known yet: a missing name is not a block. */
export const noReference: Reference = { addresses: [], exists: false };

/** Whether an answer carries an Extended DNS Error saying it was blocked. */
export const hasBlockingError = (answer: DnsAnswer): boolean =>
  answer.extendedErrors.some((e) => isBlockingError(e.code));

/**
 * Reads a resolver's answer, comparing it with the real one: a filter's
 * NXDOMAIN only blocks a name that exists, and an address the real answer
 * also has is the domain's own, never a block. Extended DNS Errors count
 * whatever the rcode.
 */
export const classify = (answer: DnsAnswer, reference: Reference): Verdict => {
  const real = new Set(reference.addresses.map(canonicalAddress));
  const v: Draft = {
    answers: [],
    blocked: false,
    detail: "",
    inspected: false,
    missing: false,
    reason: undefined,
  };
  for (const e of answer.extendedErrors) {
    if (isBlockingError(e.code)) {
      const name = extendedErrorName(e.code);
      block(v, "ede", [name, e.text].filter(Boolean).join(": "));
    }
  }
  for (const r of answer.records) {
    if (r.type === "CNAME") {
      v.answers.push(r.value);
      const reason = telenorBlockCnames.get(r.value);
      if (reason !== undefined) {
        block(v, reason);
      }
    } else {
      addAddress(v, r.value, real);
    }
  }
  if (answer.rcode === Rcode.nxDomain) {
    v.missing = true;
    if (reference.exists) {
      block(v, "nxdomain");
    }
  }
  if (!v.blocked && v.inspected) {
    v.reason = "umbrella-proxy";
  }
  return { ...v, inspected: v.inspected && !v.blocked };
};

/**
 * Reads this computer's answer. When its resolver found no address, that is
 * only a block if the real answer has an IPv4 address, which every computer
 * can use: the resolver says the same for a name that doesn't exist, one
 * without addresses, and an IPv6-only name on a computer without IPv6.
 */
export const classifySystem = (
  answer: DnsAnswer,
  noAddress: boolean,
  reference: Reference
): Verdict => {
  const v = classify(answer, reference);
  if (!noAddress) {
    return v;
  }
  if (v.blocked || !reference.addresses.some(isIpv4)) {
    return { ...v, missing: true };
  }
  return {
    ...v,
    blocked: true,
    detail: "",
    inspected: false,
    missing: true,
    reason: "no-address",
  };
};

/** Combines the verdicts for the A and AAAA answers. */
export const merge = (...verdicts: readonly Verdict[]): Verdict => {
  const blocking = verdicts.find((v) => v.blocked);
  const flagged = blocking ?? verdicts.find((v) => v.inspected);
  return {
    answers: [...new Set(verdicts.flatMap((v) => v.answers))],
    blocked: blocking !== undefined,
    detail: flagged?.detail ?? "",
    inspected: blocking === undefined && flagged !== undefined,
    missing: verdicts.length > 0 && verdicts.every((v) => v.missing),
    reason: flagged?.reason,
  };
};

/** Reads a resolver's A and AAAA answers together. */
export const classifyAll = (
  answers: readonly DnsAnswer[],
  reference: Reference
): Verdict => merge(...answers.map((a) => classify(a, reference)));

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
