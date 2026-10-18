/** Explains in a sentence or two why a row says what it says. */
import type { Verdict } from "../check/classify.ts";
import {
  isRedirected,
  shouldAnswer,
  trustedFilters,
} from "../check/evidence.ts";
import type { Filter } from "../check/filters.ts";
import {
  type CheckResult,
  nameExists,
  type Outcome,
  realAddresses,
  realAnswerKnown,
  realAnswerPending,
  realAnswerUnavailable,
} from "../check/result.ts";
import { reasonWhy } from "./reasons.ts";

const waitingForRealAnswer = "Waiting for the real answer to compare it with.";

/** Whose answer the reasons on the "Your DNS" row are about. */
const systemName = "This computer's DNS";

/** What to say of a comparison with the real answer, wherever it stands. */
interface Compared {
  readonly known: string;
  readonly pending: string;
  readonly unavailable: string;
}

const compared = (r: CheckResult, said: Compared): string => {
  if (realAnswerPending(r)) {
    return said.pending;
  }
  if (realAnswerUnavailable(r)) {
    return said.unavailable;
  }
  return said.known;
};

const missingWhy = (r: CheckResult): string =>
  compared(r, {
    known:
      "It says the domain doesn't exist, and the real answer agrees, so this is not a block.",
    pending: `It says the domain doesn't exist. ${waitingForRealAnswer}`,
    unavailable:
      "It says the domain doesn't exist. The real answer couldn't be fetched, so nbchecker can't tell whether that is a block.",
  });

/** Whether addresses that aren't a block answer agree with the real answer. */
const sameWhy = (name: string, v: Verdict, r: CheckResult): string => {
  const real = realAddresses(r);
  if (v.answers.some((a) => real.includes(a))) {
    return `Same as the real answer, so ${name} does not block this domain.`;
  }
  return `${name} gives a different address from the real answer, but not a known block answer. Sites on content delivery networks often answer differently per resolver.`;
};

const resolvesWhy = (name: string, v: Verdict, r: CheckResult): string =>
  compared(r, {
    known: sameWhy(name, v, r),
    pending: `${name} resolves the domain. ${waitingForRealAnswer}`,
    unavailable: `${name} resolves the domain. The real answer couldn't be fetched, so nbchecker can't compare the addresses.`,
  });

const verdictWhy = (name: string, v: Verdict, r: CheckResult): string => {
  if (v.reason !== undefined) {
    return reasonWhy(v.reason, name, v.detail);
  }
  if (v.missing) {
    return missingWhy(r);
  }
  return resolvesWhy(name, v, r);
};

/** Why a filter that failed the self-test doesn't count. */
const redirectedWhy = (f: Filter): string => {
  if (f.canary === undefined) {
    return `DNS on this network seems to be intercepted, and ${f.name} has no test name to show whether its answers are its own. They don't count, and the check is incomplete.`;
  }
  return `nbchecker asked ${f.name} for its test name ${f.canary.name} and didn't get the answer ${f.name} gives for it. So its answers don't look like they come from ${f.name}: DNS may be redirected on this network, to a resolver of its own. They don't count, and the check is incomplete.`;
};

/** Why a filter's row reads as it does. */
const filterWhy = (f: Filter, o: Outcome, r: CheckResult): string => {
  if (o.kind === "pending") {
    return "Waiting for an answer.";
  }
  if (o.kind === "answered" && isRedirected(r, f)) {
    return redirectedWhy(f);
  }
  if (o.kind === "cancelled") {
    return "The check was cancelled before it answered.";
  }
  if (o.kind === "failed" && f.onlyAnswers !== undefined) {
    if (!shouldAnswer(r, f)) {
      return `${f.name} only answers ${f.onlyAnswers.customers}, so it can't be asked from this network. That is expected elsewhere and doesn't make the check incomplete.`;
    }
    return `None of its servers answered, though ${f.name} should answer this computer, so the check is incomplete: ${o.error}`;
  }
  if (o.kind === "failed") {
    return `None of its servers answered: ${o.error}`;
  }
  return verdictWhy(f.name, o.verdict, r);
};

const systemBlockWhy = (v: Verdict, r: CheckResult): string => {
  const same = trustedFilters(r).find(
    (f) =>
      f.outcome.kind === "answered" && f.outcome.verdict.reason === v.reason
  );
  if (same !== undefined && v.reason !== "null-ip" && v.reason !== "nxdomain") {
    return `This computer gets the same block answer as ${same.filter.name}, so the domain is blocked here.`;
  }
  if (v.reason === undefined) {
    return "";
  }
  return reasonWhy(v.reason, systemName, v.detail);
};

/** Why this computer finding no address is not a block. */
const noAddressWhy = (r: CheckResult): string => {
  const same =
    "This computer's resolver found no address for the domain. It says the same for a domain that doesn't exist, one without addresses, and one with only IPv6 addresses on a computer without IPv6,";
  return compared(r, {
    known: `${same} and the real answer has no IPv4 address, so this is not a block.`,
    pending: `${same} so it is compared with the real answer. ${waitingForRealAnswer}`,
    unavailable: `${same} and the real answer couldn't be fetched, so nbchecker can't tell whether this is a block.`,
  });
};

/** Why this computer resolving the domain is not a block. */
const resolvesHereWhy = (r: CheckResult): string => {
  if (realAnswerKnown(r) && !nameExists(r)) {
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
  if (o.kind === "cancelled") {
    return "The check was cancelled before this computer's resolver answered.";
  }
  if (o.kind === "failed") {
    return `This computer's resolver failed: ${o.error}`;
  }
  if (o.verdict.blocked) {
    return `${systemBlockWhy(o.verdict, r)}${browsers}`;
  }
  if (o.verdict.inspected) {
    return `${reasonWhy("umbrella-proxy", systemName, "")}${browsers}`;
  }
  if (o.verdict.missing) {
    return noAddressWhy(r);
  }
  return `${resolvesHereWhy(r)}${browsers}`;
};

/** Why the "Real answer" row reads as it does. */
const realAnswerWhy = (r: CheckResult): string => {
  const o = r.realAnswer;
  if (o.kind === "cancelled") {
    return "The check was cancelled before the real answer arrived.";
  }
  if (o.kind === "failed") {
    return `No unfiltered resolver could be reached: ${o.error}. Without it, a filter that says a domain doesn't exist can't be told apart from a domain that really doesn't.`;
  }
  if (o.kind === "pending") {
    return "Waiting for the real answer, fetched over encrypted DNS so no filter on your network can change it.";
  }
  return "The real answer, fetched over encrypted DNS so no filter on your network can change it. Every other row is compared with this.";
};

export { filterWhy, realAnswerWhy, systemWhy };
