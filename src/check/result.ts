import type { DnsAnswer } from "../dns/wire.ts";
import type { Verdict } from "./classify.ts";
import type { Filter } from "./filters.ts";

const outcomeBlocks = (o: Outcome | undefined): boolean =>
  o?.kind === "answered" && o.verdict.blocked;

const cancelled: Outcome = { error: "cancelled", kind: "failed", ms: 0 };

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

export interface CheckResult {
  /** DNS was checked; false for an IP address with no reverse name. */
  readonly checked: boolean;
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
    truthError = "cancelled";
  }
  return {
    ...r,
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
