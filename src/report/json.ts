/** The --json output. */
import type { Verdict } from "../check/classify.ts";
import { isBlocked, isRedirected } from "../check/evidence.ts";
import type { Category, Filter } from "../check/filters.ts";
import {
  type CheckResult,
  type Completion,
  nameExists,
  type Outcome,
  realAddresses,
  realAnswerUnavailable,
} from "../check/result.ts";
import { type StatusKind, statusOf } from "./status.ts";

/** What JSON says for a lookup cut short by a cancelled check. */
const cancelledError = "cancelled";

interface JsonVerdict {
  readonly answers?: readonly string[];
  readonly blocked: boolean;
  readonly detail?: string;
  readonly error?: string;
  /** Sent through an inspection proxy, which may still block some URLs. */
  readonly inspected?: boolean;
  /**
   * It failed the self-test, so its answers seem to come from another
   * resolver and don't count.
   */
  readonly intercepted?: boolean;
  readonly reason?: string;
  readonly server?: string;
}

/** A filter's verdict, after its category and name. */
interface JsonFilter extends JsonVerdict {
  readonly category: Category;
  readonly name: string;
}

/** One target's result, its keys in the order they are written. */
interface JsonResult {
  readonly blocked: boolean;
  readonly completion: Completion;
  readonly error: string | undefined;
  readonly exists: boolean;
  readonly filters: readonly JsonFilter[];
  readonly host: string;
  readonly isIp: boolean;
  readonly notes: readonly string[];
  readonly realAnswer: readonly string[];
  readonly realAnswerError: string | undefined;
  readonly status: StatusKind;
  readonly target: string;
  readonly thisComputer: JsonVerdict | undefined;
}

const verdictFields = (v: Verdict) => {
  const out: { -readonly [K in keyof JsonVerdict]: JsonVerdict[K] } = {
    blocked: v.blocked,
  };
  if (v.answers.length > 0) {
    out.answers = v.answers;
  }
  if (v.inspected) {
    out.inspected = true;
  }
  if (v.reason !== undefined) {
    out.reason = v.reason;
  }
  if (v.detail !== "") {
    out.detail = v.detail;
  }
  return out;
};

const outcomeJson = (o: Outcome): JsonVerdict => {
  if (o.kind === "pending") {
    return { blocked: false, error: "not asked" };
  }
  if (o.kind === "cancelled") {
    return { blocked: false, error: cancelledError };
  }
  if (o.kind === "failed") {
    return { blocked: false, error: o.error };
  }
  return { ...verdictFields(o.verdict), server: o.exchange.server };
};

const filterJson = (r: CheckResult, f: Filter, o: Outcome): JsonVerdict => {
  if (isRedirected(r, f)) {
    return { ...outcomeJson(o), blocked: false, intercepted: true };
  }
  return outcomeJson(o);
};

/** Why there is no real answer: its error, or that the check was cancelled. */
const realAnswerError = (r: CheckResult): string | undefined => {
  if (!realAnswerUnavailable(r)) {
    return;
  }
  if (r.realAnswer.kind === "failed") {
    return r.realAnswer.error;
  }
  return cancelledError;
};

/** This computer's answer, left out when nothing was checked. */
const thisComputerJson = (r: CheckResult): JsonVerdict | undefined => {
  if (!r.checked) {
    return;
  }
  return outcomeJson(r.system);
};

const resultJson = (r: CheckResult): JsonResult => ({
  blocked: isBlocked(r),
  completion: r.completion,
  // JSON.stringify leaves out fields that are undefined.
  error: r.lookupError,
  exists: nameExists(r),
  filters: r.filters.map((f) => ({
    category: f.filter.category,
    name: f.filter.name,
    ...filterJson(r, f.filter, f.outcome),
  })),
  host: r.host,
  isIp: r.isIp,
  notes: r.notes,
  realAnswer: realAddresses(r),
  realAnswerError: realAnswerError(r),
  status: statusOf(r).kind,
  target: r.target,
  thisComputer: thisComputerJson(r),
});

/**
 * The whole document. `intercepted` lists the filters that failed the
 * self-test; it is left out when the self-test didn't run.
 */
export const toJson = (
  meta: {
    readonly dnsFilter: string;
    readonly intercepted?: readonly string[] | undefined;
    readonly version: string;
  },
  results: readonly CheckResult[]
) => ({ ...meta, results: results.map(resultJson) });
