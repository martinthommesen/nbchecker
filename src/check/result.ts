import type { DnsAnswer } from "../dns/wire.ts";
import type { Verdict } from "./classify.ts";
import type { Connection } from "./connection.ts";
import type { Filter } from "./filters.ts";

const outcomeBlocks = (o: Outcome | undefined): boolean =>
  o?.kind === "answered" && o.verdict.blocked;

/** The error of a lookup that was still running when a check was cancelled. */
const cancelledError = "cancelled";

const cancelled: Outcome = { error: cancelledError, kind: "failed", ms: 0 };

const settle = (o: Outcome): Outcome => {
  if (o.kind === "pending") {
    return cancelled;
  }
  return o;
};

/** How one resolver was asked, and what it said. */
export interface Exchange {
  /** The raw answers to the A and AAAA queries. */
  readonly answers: readonly DnsAnswer[];
  readonly ms: number;
  /** What the raw answers leave out, such as a CNAME query that failed. */
  readonly notes?: readonly string[];
  readonly server: string;
  /** How it was asked, such as "UDP 53". */
  readonly transport: string;
}

export type Outcome =
  | { readonly kind: "pending" }
  | { readonly error: string; readonly kind: "failed"; readonly ms: number }
  | {
      readonly exchange: Exchange;
      readonly kind: "answered";
      readonly verdict: Verdict;
    };

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
  /** An unfiltered resolver found the name. */
  readonly exists: boolean;
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
  /** What this computer's own DNS says; undefined when not checked. */
  readonly system: Outcome | undefined;
  readonly target: string;
  /** The unfiltered answers. */
  readonly truth: readonly string[];
  readonly truthError: string | undefined;
  /** How the unfiltered answer was fetched; undefined until it arrives. */
  readonly truthExchange: Exchange | undefined;
}

export const pending: Outcome = { kind: "pending" };

/** Whether the real answer was cut short by a cancelled check. */
export const truthCancelled = (r: CheckResult): boolean =>
  r.truthError === cancelledError;

/** Whether an outcome is a lookup cut short by a cancelled check. */
export const wasCancelled = (o: Outcome): boolean =>
  o.kind === "failed" && o.error === cancelledError;

/**
 * Whether a filter should answer this computer. One that only answers its
 * own network's customers needn't, unless this computer is on that network,
 * or the connection couldn't be detected, so nobody can tell.
 */
export const shouldAnswer = (r: CheckResult, f: Filter): boolean => {
  const c = r.network?.connection;
  if (f.network === undefined || c === undefined || c.error !== undefined) {
    return true;
  }
  return c.network === f.network;
};

/**
 * Whether a filter failed the self-test, so its answers seem to come from
 * somewhere else and say nothing about the filter.
 */
export const isRedirected = (r: CheckResult, f: Filter): boolean =>
  r.network?.selfTests.some(
    (t) => t.filter === f.name && t.result === "redirected"
  ) ?? false;

/** The filters whose answers count: all but those that failed the self-test. */
export const trustedFilters = (r: CheckResult): readonly FilterResult[] =>
  r.filters.filter((f) => !isRedirected(r, f.filter));

/** The filters that failed the self-test. */
export const redirectedFilters = (n: Network): readonly string[] =>
  n.selfTests.filter((t) => t.result === "redirected").map((t) => t.filter);

/**
 * Whether most filters that answered the self-test failed it, so DNS on
 * this network seems to be intercepted.
 */
export const seemsIntercepted = (n: Network | undefined): boolean => {
  if (n === undefined) {
    return false;
  }
  const passed = n.selfTests.filter((t) => t.result === "passed").length;
  return redirectedFilters(n).length > passed;
};

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
  const failed = (o: Outcome | undefined) => o?.kind === "failed";
  if (
    r.network === undefined ||
    r.truthExchange === undefined ||
    outcomes.some((o) => o === undefined || o.kind === "pending") ||
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

/** Whether the unfiltered answer is still on its way. */
export const truthPending = (r: CheckResult): boolean =>
  r.checked && r.truthError === undefined && r.truthExchange === undefined;

/** Marks everything that hadn't answered when a check was cancelled. */
export const cancelPending = (r: CheckResult): CheckResult => {
  let { system, truthError } = r;
  if (system !== undefined) {
    system = settle(system);
  }
  if (truthPending(r)) {
    truthError = cancelledError;
  }
  return {
    ...r,
    completion: "cancelled",
    filters: r.filters.map((f) => ({ ...f, outcome: settle(f.outcome) })),
    system,
    truthError,
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
  exists: false,
  filters: [],
  host,
  isIp,
  lookupError: undefined,
  network: undefined,
  notes: [],
  system: undefined,
  target,
  truth: [],
  truthError: undefined,
  truthExchange: undefined,
});
