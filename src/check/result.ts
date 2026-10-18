import type { Verdict } from "./classify.ts";
import type { Filter } from "./filters.ts";

const outcomeBlocks = (o: Outcome | undefined): boolean =>
  o?.kind === "answered" && o.verdict.blocked;

export type Outcome =
  | { readonly error: string; readonly kind: "failed" }
  | {
      readonly kind: "answered";
      readonly server: string;
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
}

/** Whether any filter, or this computer, blocks the target. */
export const isBlocked = (r: CheckResult): boolean =>
  r.filters.some((f) => outcomeBlocks(f.outcome)) || outcomeBlocks(r.system);

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
});
