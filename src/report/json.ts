/** The --json output and the exit status. */
import type { Verdict } from "../check/classify.ts";
import { type CheckResult, isBlocked, type Outcome } from "../check/result.ts";

interface JsonVerdict {
  readonly answers?: readonly string[];
  readonly blocked: boolean;
  readonly detail?: string;
  readonly error?: string;
  readonly reason?: string;
  readonly server?: string;
}

const verdictFields = (v: Verdict) => {
  const out: { -readonly [K in keyof JsonVerdict]: JsonVerdict[K] } = {
    blocked: v.blocked,
  };
  if (v.answers.length > 0) {
    out.answers = v.answers;
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
  if (o.kind === "failed") {
    return { blocked: false, error: o.error };
  }
  return { ...verdictFields(o.verdict), server: o.exchange.server };
};

const resultJson = (r: CheckResult) => ({
  blocked: isBlocked(r),
  // JSON.stringify leaves out fields that are undefined.
  error: r.lookupError,
  exists: r.exists,
  filters: r.filters.map((f) => ({
    category: f.filter.category,
    name: f.filter.name,
    ...outcomeJson(f.outcome),
  })),
  host: r.host,
  isIp: r.isIp,
  notes: r.notes,
  realAnswer: r.truth,
  realAnswerError: r.truthError,
  target: r.target,
  thisComputer: r.system && outcomeJson(r.system),
});

/**
 * A check is incomplete when something that should have answered didn't:
 * the real answer, this computer's resolver or a filter. A
 * filter that only answers some networks, such as an ISP's, doesn't count.
 */
const incomplete = (r: CheckResult): boolean =>
  r.lookupError !== undefined ||
  (r.checked &&
    (r.truthError !== undefined ||
      r.system?.kind === "failed" ||
      r.filters.some(
        (f) => f.outcome.kind === "failed" && f.filter.onlyAnswers === undefined
      )));

export const exitBlocked = 1;
export const exitIncomplete = 2;

/**
 * 1 if anything is blocked, even when some lookups didn't answer; otherwise
 * 2 if a check was incomplete, and 0 if nothing is blocked.
 */
export const exitCode = (results: readonly CheckResult[]): number => {
  if (results.some(isBlocked)) {
    return exitBlocked;
  }
  if (results.some(incomplete)) {
    return exitIncomplete;
  }
  return 0;
};

export const toJson = (
  meta: { readonly dnsFilter: string; readonly version: string },
  results: readonly CheckResult[]
) => ({ ...meta, results: results.map(resultJson) });
