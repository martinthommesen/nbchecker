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
  /**
   * Which filter this computer's DNS goes through, detected during the
   * check; undefined until it is. It says whether an ISP's filter that only
   * answers its own customers should have answered.
   */
  readonly connection: Connection | undefined;
  /** An unfiltered resolver found the name. */
  readonly exists: boolean;
  readonly filters: readonly FilterResult[];
  /** The name looked up: from a URL, or the reverse name of an IP. */
  readonly host: string;
  readonly isIp: boolean;
  /** The target could not be looked up at all. */
  readonly lookupError: string | undefined;
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
  const c = r.connection;
  if (f.network === undefined || c === undefined || c.error !== undefined) {
    return true;
  }
  return c.network === f.network;
};

/** Works out whether everything that should have answered did. */
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
    r.connection === undefined ||
    r.truthExchange === undefined ||
    outcomes.some((o) => o === undefined || o.kind === "pending") ||
    failed(r.system) ||
    r.filters.some((f) => failed(f.outcome) && shouldAnswer(r, f.filter))
  ) {
    return "incomplete";
  }
  return "complete";
};

/** Whether any filter, or this computer, blocks the target. */
export const isBlocked = (r: CheckResult): boolean =>
  r.filters.some((f) => outcomeBlocks(f.outcome)) || outcomeBlocks(r.system);

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
  connection: undefined,
  exists: false,
  filters: [],
  host,
  isIp,
  lookupError: undefined,
  notes: [],
  system: undefined,
  target,
  truth: [],
  truthError: undefined,
  truthExchange: undefined,
});
