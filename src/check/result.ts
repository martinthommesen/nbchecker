/**
 * What a check finds out, from one answer up to the whole check: a Verdict
 * reads one resolver's answer, an Outcome says how asking one resolver went,
 * and the Completion here and the report's Status sum up the whole check.
 */
import type { DnsAnswer } from "../dns/wire.ts";
import type { Reference, Verdict } from "./classify.ts";
import type { Connection } from "./connection.ts";
import type { Filter } from "./filters.ts";

const outcomeBlocks = (o: Outcome): boolean =>
  o.kind === "answered" && o.verdict.blocked;

const cancelled = { kind: "cancelled" } as const;

/** A lookup still on its way when the check was cancelled never arrives. */
const settle = <A>(o: Outcome<A>): Outcome<A> => {
  if (o.kind === "pending") {
    return cancelled;
  }
  return o;
};

/** One failed self-test marks that filter, not the whole network. */
const minRedirected = 2;

/** A filter's or this computer's answer, and what it means for the name. */
interface Resolved {
  readonly exchange: Exchange;
  readonly verdict: Verdict;
}

/** How one resolver was asked, and what it said. */
export interface Exchange {
  /** The raw answers to the A and AAAA queries. */
  readonly answers: readonly DnsAnswer[];
  readonly ms: number;
  /** What the raw answers leave out, such as a CNAME query that failed. */
  readonly notes?: readonly string[];
  readonly server: string;
}

/**
 * How asking one resolver went: still on its way, cut short by a cancelled
 * check, failed, or answered with `A`.
 */
export type Outcome<A = Resolved> =
  | { readonly kind: "pending" }
  | { readonly kind: "cancelled" }
  | { readonly error: string; readonly kind: "failed"; readonly ms: number }
  | (A & { readonly kind: "answered" });

/** What the unfiltered resolver says, and how it was asked. */
export type RealAnswer = Reference & { readonly exchange: Exchange };

/**
 * How a filter answered the self-test, which asks it for a name it
 * documents as blocked: "redirected" when the answer isn't its block, and
 * "untested" for a filter that documents no such name.
 */
export type SelfTestResult = "no-answer" | "passed" | "redirected" | "untested";

export interface SelfTest {
  /** What it answered, for display. */
  readonly answers: readonly string[];
  readonly filter: string;
  readonly result: SelfTestResult;
}

/** What is found out about this computer's network, once per run. */
export interface Network {
  readonly connection: Connection;
  readonly selfTests: readonly SelfTest[];
}

export interface FilterResult {
  readonly filter: Filter;
  readonly outcome: Outcome;
}

/**
 * Whether everything that should have answered did: "incomplete" while
 * answers are still on their way or when one failed, and "cancelled" when
 * the check was stopped before they all arrived.
 */
export type Completion = "cancelled" | "complete" | "incomplete";

export interface CheckResult {
  /** DNS was checked; false for an IP address with no reverse name. */
  readonly checked: boolean;
  readonly completion: Completion;
  readonly filters: readonly FilterResult[];
  /** The name looked up: from a URL, or the reverse name of an IP. */
  readonly host: string;
  readonly isIp: boolean;
  /** The target could not be looked up at all. */
  readonly lookupError: string | undefined;
  /**
   * Which filter this computer's DNS goes through, and which filters passed
   * the self-test; undefined until known. The connection says whether an
   * ISP's filter that only answers its own customers should have answered.
   */
  readonly network: Network | undefined;
  readonly notes: readonly string[];
  /** The unfiltered answer every other answer is read against. */
  readonly realAnswer: Outcome<RealAnswer>;
  /** What this computer's own DNS says; pending when not checked. */
  readonly system: Outcome;
  readonly target: string;
}

/** A lookup still on its way. */
export const pending = { kind: "pending" } as const;

/** Whether a lookup is over, whichever way it went. */
export const settled = (o: Outcome<unknown>): boolean => o.kind !== "pending";

/** Whether the real answer is still on its way. */
export const realAnswerPending = (r: CheckResult): boolean =>
  r.checked && r.realAnswer.kind === "pending";

/** Whether the real answer arrived. */
export const realAnswerKnown = (r: CheckResult): boolean =>
  r.realAnswer.kind === "answered";

/** Whether the real answer failed or was cut short by a cancel. */
export const realAnswerUnavailable = (r: CheckResult): boolean =>
  r.realAnswer.kind === "failed" || r.realAnswer.kind === "cancelled";

/** Whether the real answer says the name exists. */
export const nameExists = (r: CheckResult): boolean =>
  r.realAnswer.kind === "answered" && r.realAnswer.exists;

/** The real answer's addresses; none until it arrives. */
export const realAddresses = (r: CheckResult): readonly string[] => {
  if (r.realAnswer.kind === "answered") {
    return r.realAnswer.addresses;
  }
  return [];
};

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
  if (n === undefined) {
    return false;
  }
  const passed = n.selfTests.filter((t) => t.result === "passed").length;
  const redirected = redirectedFilters(n).length;
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
  trustedFilters(r).some((f) => outcomeBlocks(f.outcome)) ||
  outcomeBlocks(r.system);

/**
 * Marks everything that hadn't answered when a check was cancelled. The real
 * answer and this computer's lookup only when the check asked them.
 */
export const cancelPending = (r: CheckResult): CheckResult => {
  const stopped: CheckResult = {
    ...r,
    completion: "cancelled",
    filters: r.filters.map((f) => ({ ...f, outcome: settle(f.outcome) })),
  };
  if (!r.checked) {
    return stopped;
  }
  return {
    ...stopped,
    realAnswer: settle(r.realAnswer),
    system: settle(r.system),
  };
};

/** A result with nothing looked up yet. */
export const unchecked = (
  target: string,
  host: string,
  isIp: boolean
): CheckResult => ({
  checked: false,
  completion: "complete",
  filters: [],
  host,
  isIp,
  lookupError: undefined,
  network: undefined,
  notes: [],
  realAnswer: pending,
  system: pending,
  target,
});
