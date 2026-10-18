/** Explains in a sentence or two why a row says what it says. */
import type { Reason, Verdict } from "../check/classify.ts";
import type { Filter } from "../check/filters.ts";
import {
  type CheckResult,
  type Outcome,
  shouldAnswer,
  truthCancelled,
  truthPending,
  wasCancelled,
} from "../check/result.ts";

/** Why an answer is blocked, or for the inspection proxy, why it isn't. */
const reasonWhy: Record<Reason, (name: string, detail: string) => string> = {
  adguard: () =>
    "The answer points to AdGuard's block page, 94.140.14.35, which AdGuard Family gives for sites it blocks.",
  ede: (name, detail) =>
    `${name} says outright that it blocked the domain, using an Extended DNS Error (${detail}).`,
  kripos: () =>
    "The domain is on the police's child sexual abuse block list, so it points to Kripos' stop page at kid.telenor.net.",
  legal: () =>
    "Telenor blocks this domain for all its customers on legal grounds, such as a court order, by pointing it to dns-block.telenor.net.",
  nettvern: () =>
    "Nettvern answers blocked domains with a CNAME to nettvern-info.telenor.net, which shows Telenor's warning page.",
  "nettvern+": () =>
    "Nettvern+ blocks everything Nettvern does, plus more categories. Its block answer points to nettvernpluss-info.telenor.net.",
  "no-address": () =>
    "This computer's resolver finds no address for the domain, while the real answer has an IPv4 address, which every computer can use. So something on the way blocks it.",
  "null-ip": (name) =>
    `${name} answers 0.0.0.0 or :: for domains it blocks, so nothing loads.`,
  nxdomain: (name) =>
    `${name} says the domain does not exist, while the real answer says it does, so it is blocking it.`,
  umbrella: (_, detail) =>
    `The answer points to a Cisco Umbrella block page (${detail}).`,
  "umbrella-proxy": () =>
    "The answer points to Cisco's inspection proxy, so the site is sent through it rather than blocked by DNS. The proxy checks the pages as they load and may still block some URLs.",
};

const waitingForTruth = "Waiting for the real answer to compare it with.";

const missingWhy = (r: CheckResult): string => {
  if (truthPending(r)) {
    return `It says the domain doesn't exist. ${waitingForTruth}`;
  }
  if (r.truthError !== undefined) {
    return "It says the domain doesn't exist. The real answer couldn't be fetched, so nbchecker can't tell whether that is a block.";
  }
  return "It says the domain doesn't exist, and the real answer agrees, so this is not a block.";
};

const resolvesWhy = (name: string, v: Verdict, r: CheckResult): string => {
  if (truthPending(r)) {
    return `${name} resolves the domain. ${waitingForTruth}`;
  }
  if (r.truthError !== undefined) {
    return `${name} resolves the domain. The real answer couldn't be fetched, so nbchecker can't compare the addresses.`;
  }
  if (v.answers.some((a) => r.truth.includes(a))) {
    return `Same as the real answer, so ${name} does not block this domain.`;
  }
  return `${name} gives a different address from the real answer, but not a known block answer. Sites on content delivery networks often answer differently per resolver.`;
};

const verdictWhy = (name: string, v: Verdict, r: CheckResult): string => {
  if (v.reason !== undefined) {
    return reasonWhy[v.reason](name, v.detail);
  }
  if (v.missing) {
    return missingWhy(r);
  }
  return resolvesWhy(name, v, r);
};

/** Why a filter's row reads as it does. */
const filterWhy = (f: Filter, o: Outcome, r: CheckResult): string => {
  if (o.kind === "pending") {
    return "Waiting for an answer.";
  }
  if (o.kind === "failed" && wasCancelled(o)) {
    return "The check was cancelled before it answered.";
  }
  if (o.kind === "failed" && f.onlyAnswers !== undefined) {
    if (!shouldAnswer(r, f)) {
      return `${f.name} only answers ${f.onlyAnswers}, so it can't be asked from this network. That is expected elsewhere and doesn't make the check incomplete.`;
    }
    return `None of its servers answered, though ${f.name} should answer this computer, so the check is incomplete: ${o.error}`;
  }
  if (o.kind === "failed") {
    return `None of its servers answered: ${o.error}`;
  }
  return verdictWhy(f.name, o.verdict, r);
};

const systemBlockWhy = (v: Verdict, r: CheckResult): string => {
  const same = r.filters.find(
    (f) =>
      f.outcome.kind === "answered" && f.outcome.verdict.reason === v.reason
  );
  if (same !== undefined && v.reason !== "null-ip" && v.reason !== "nxdomain") {
    return `This computer gets the same block answer as ${same.filter.name}, so the domain is blocked here.`;
  }
  if (v.reason === undefined) {
    return "";
  }
  return reasonWhy[v.reason]("This computer's DNS", v.detail);
};

/** Why this computer finding no address is not a block. */
const noAddressWhy = (r: CheckResult): string => {
  const same =
    "This computer's resolver found no address for the domain. It says the same for a domain that doesn't exist, one without addresses, and one with only IPv6 addresses on a computer without IPv6,";
  if (truthPending(r)) {
    return `${same} so it is compared with the real answer. ${waitingForTruth}`;
  }
  if (r.truthError !== undefined) {
    return `${same} and the real answer couldn't be fetched, so nbchecker can't tell whether this is a block.`;
  }
  return `${same} and the real answer has no IPv4 address, so this is not a block.`;
};

/** Why this computer resolving the domain is not a block. */
const resolvesHereWhy = (r: CheckResult): string => {
  if (r.truthExchange !== undefined && !r.exists) {
    return "This computer resolves the domain, but the public DNS says it doesn't exist, so it only resolves here, as with a private network or split DNS.";
  }
  return "This computer's own DNS resolves the domain, so no DNS filter blocks it here.";
};

/** Why the "Your DNS" row reads as it does. */
const systemWhy = (o: Outcome, r: CheckResult): string => {
  const browsers =
    " A browser with secure DNS turned on asks its own server, so it may differ.";
  if (o.kind === "pending") {
    return "Waiting for this computer's resolver.";
  }
  if (o.kind === "failed" && wasCancelled(o)) {
    return "The check was cancelled before this computer's resolver answered.";
  }
  if (o.kind === "failed") {
    return `This computer's resolver failed: ${o.error}`;
  }
  if (o.verdict.blocked) {
    return `${systemBlockWhy(o.verdict, r)}${browsers}`;
  }
  if (o.verdict.inspected) {
    return `${reasonWhy["umbrella-proxy"]("This computer's DNS", "")}${browsers}`;
  }
  if (o.verdict.missing) {
    return noAddressWhy(r);
  }
  return `${resolvesHereWhy(r)}${browsers}`;
};

/** Why the "Real answer" row reads as it does. */
const truthWhy = (r: CheckResult): string => {
  if (truthCancelled(r)) {
    return "The check was cancelled before the real answer arrived.";
  }
  if (r.truthError !== undefined) {
    return `No unfiltered resolver could be reached: ${r.truthError}. Without it, a filter that says a domain doesn't exist can't be told apart from a domain that really doesn't.`;
  }
  if (truthPending(r)) {
    return "Waiting for the real answer, fetched over encrypted DNS so no filter on your network can change it.";
  }
  return "The real answer, fetched over encrypted DNS so no filter on your network can change it. Every other row is compared with this.";
};

export { filterWhy, systemWhy, truthWhy };
