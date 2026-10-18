/**
 * What each reason for a verdict means: a phrase for its row, and the longer
 * explanation of why, side by side so they say the same thing.
 */
import type { Reason, Verdict } from "../check/classify.ts";

interface ReasonWords {
  /** A phrase for the row. */
  readonly text: string;
  /**
   * Why an answer is blocked, or for the inspection proxy, why it isn't.
   * `name` says whose answer it is.
   */
  readonly why: (name: string, detail: string) => string;
}

const reasons: Record<Reason, ReasonWords> = {
  adguard: {
    text: "blocked: points to AdGuard's block page",
    why: () =>
      "The answer points to AdGuard's block page, 94.140.14.35, which AdGuard Family gives for sites it blocks.",
  },
  ede: {
    text: "blocked with an Extended DNS Error",
    why: (name, detail) =>
      `${name} says outright that it blocked the domain, using an Extended DNS Error (${detail}).`,
  },
  kripos: {
    text: "blocked by the Kripos child-abuse filter",
    why: () =>
      "The domain is on the police's child sexual abuse block list, so it points to Kripos' stop page at kid.telenor.net.",
  },
  legal: {
    text: "blocked by Telenor on legal grounds, for every Telenor customer",
    why: () =>
      "Telenor blocks this domain for all its customers on legal grounds, such as a court order, by pointing it to dns-block.telenor.net.",
  },
  nettvern: {
    text: "blocked by Nettvern",
    why: () =>
      "Nettvern answers blocked domains with a CNAME to nettvern-info.telenor.net, which shows Telenor's warning page.",
  },
  "nettvern+": {
    text: "blocked by Nettvern+",
    why: () =>
      "Nettvern+ blocks everything Nettvern does, plus more categories. Its block answer points to nettvernpluss-info.telenor.net.",
  },
  "no-address": {
    text: "blocked: no address on this computer, though the domain has one",
    why: () =>
      "This computer's resolver finds no address for the domain, while the real answer has an IPv4 address, which every computer can use. So something on the way blocks it.",
  },
  "null-ip": {
    text: "blocked: answers 0.0.0.0",
    why: (name) =>
      `${name} answers 0.0.0.0 or :: for domains it blocks, so nothing loads.`,
  },
  nxdomain: {
    text: "blocked: says the domain doesn't exist",
    why: (name) =>
      `${name} says the domain does not exist, while the real answer says it does, so it is blocking it.`,
  },
  umbrella: {
    text: "blocked by Cisco Umbrella",
    why: (_, detail) =>
      `The answer points to a Cisco Umbrella block page (${detail}).`,
  },
  "umbrella-proxy": {
    text: "sent through Cisco's inspection proxy; the site may still be blocked by URL",
    why: () =>
      "The answer points to Cisco's inspection proxy, so the site is sent through it rather than blocked by DNS. The proxy checks the pages as they load and may still block some URLs.",
  },
};

/** Says what a verdict means, in a phrase for its row. */
export const verdictText = (v: Verdict): string => {
  if (v.reason === undefined) {
    if (v.missing) {
      return "not found (the domain doesn't exist)";
    }
    return "not blocked";
  }
  const { text } = reasons[v.reason];
  if (v.detail === "") {
    return text;
  }
  return `${text} (${v.detail})`;
};

/**
 * Explains a reason in a sentence or two. `name` says whose answer it is,
 * and `detail` is the verdict's, such as the Umbrella category.
 */
export const reasonWhy = (
  reason: Reason,
  name: string,
  detail: string
): string => reasons[reason].why(name, detail);
