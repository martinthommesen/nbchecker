/** Which answers count as evidence, and what they add up to. */
import type { Filter } from "./filters.ts";
import {
  type CheckResult,
  type Completion,
  type FilterResult,
  type Network,
  type Outcome,
  realAnswerKnown,
} from "./result.ts";

/** One failed self-test marks that filter, not the whole network. */
const minRedirected = 2;

/** How many filters passed the self-test, and how many failed it. */
export const selfTestCounts = (n: Network | undefined) => {
  const tests = n?.selfTests ?? [];
  return {
    passed: tests.filter((t) => t.result === "passed").length,
    redirected: tests.filter((t) => t.result === "redirected").length,
  };
};

/** Whether a resolver answered, and its verdict says `flag`. */
export const answeredWith = (
  o: Outcome,
  flag: "blocked" | "inspected" | "missing"
): boolean => o.kind === "answered" && o.verdict[flag];

/**
 * Whether a filter should answer this computer. One that only answers its
 * own network's customers needn't, unless this computer is on that network,
 * or the connection couldn't be detected, so nobody can tell.
 */
export const shouldAnswer = (r: CheckResult, f: Filter): boolean => {
  const c = r.network?.connection;
  if (f.onlyAnswers === undefined || c === undefined || c.error !== undefined) {
    return true;
  }
  return c.network === f.onlyAnswers.network;
};

/** The filters that failed the self-test. */
export const redirectedFilters = (n: Network): readonly string[] =>
  n.selfTests.filter((t) => t.result === "redirected").map((t) => t.filter);

/**
 * Whether most filters that answered the self-test failed it, and more than
 * one did, so DNS on this network seems to be intercepted.
 */
export const seemsIntercepted = (n: Network | undefined): boolean => {
  const { passed, redirected } = selfTestCounts(n);
  return redirected >= minRedirected && redirected > passed;
};

/**
 * Whether a filter's answers seem to come from somewhere else and say
 * nothing about the filter: it failed the self-test, or it has none on a
 * network that seems to intercept DNS.
 */
export const isRedirected = (r: CheckResult, f: Filter): boolean => {
  const test = r.network?.selfTests.find((t) => t.filter === f.name);
  if (test?.result === "redirected") {
    return true;
  }
  return test?.result === "untested" && seemsIntercepted(r.network);
};

/** The filters whose answers count: all but those that seem redirected. */
export const trustedFilters = (r: CheckResult): readonly FilterResult[] =>
  r.filters.filter((f) => !isRedirected(r, f.filter));

/**
 * Works out whether everything that should have answered did, with answers
 * that can be trusted.
 */
export const completionOf = (r: CheckResult): Completion => {
  if (r.lookupError !== undefined) {
    return "incomplete";
  }
  if (!r.checked) {
    return "complete";
  }
  const outcomes = [r.system, ...r.filters.map((f) => f.outcome)];
  // A lookup cut short by a cancel didn't answer either.
  const failed = (o: Outcome) => o.kind === "failed" || o.kind === "cancelled";
  if (
    r.network === undefined ||
    !realAnswerKnown(r) ||
    outcomes.some((o) => o.kind === "pending") ||
    failed(r.system) ||
    r.filters.some((f) => failed(f.outcome) && shouldAnswer(r, f.filter)) ||
    r.filters.some((f) => isRedirected(r, f.filter))
  ) {
    return "incomplete";
  }
  return "complete";
};

/** Whether any trusted filter, or this computer, blocks the target. */
export const isBlocked = (r: CheckResult): boolean =>
  trustedFilters(r).some((f) => answeredWith(f.outcome, "blocked")) ||
  answeredWith(r.system, "blocked");
