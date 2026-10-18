/** The --json output. */
import type { Verdict } from "../check/classify.ts";
import type { Filter } from "../check/filters.ts";
import {
  type CheckResult,
  isBlocked,
  isRedirected,
  type Outcome,
} from "../check/result.ts";
import { statusOf } from "./status.ts";

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

const resultJson = (r: CheckResult) => ({
  blocked: isBlocked(r),
  completion: r.completion,
  // JSON.stringify leaves out fields that are undefined.
  error: r.lookupError,
  exists: r.exists,
  filters: r.filters.map((f) => ({
    category: f.filter.category,
    name: f.filter.name,
    ...filterJson(r, f.filter, f.outcome),
  })),
  host: r.host,
  isIp: r.isIp,
  notes: r.notes,
  realAnswer: r.realAddresses,
  realAnswerError: r.realAnswerError,
  status: statusOf(r).kind,
  target: r.target,
  thisComputer: r.system && outcomeJson(r.system),
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
