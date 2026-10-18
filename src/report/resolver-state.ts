/**
 * What each resolver's row says happened, decided once for the text output,
 * the table and the screen's summary, which each show it in their own way.
 */
import type { Verdict } from "../check/classify.ts";
import { isRedirected, shouldAnswer } from "../check/evidence.ts";
import {
  type CheckResult,
  type FilterResult,
  realAnswerUnavailable,
} from "../check/result.ts";

/** What an answer says: a block, the inspection proxy, no name, or addresses. */
const answerState = (v: Verdict): ResolverState => {
  if (v.blocked) {
    return "blocked";
  }
  if (v.inspected) {
    return "inspected";
  }
  if (v.missing) {
    return "missing";
  }
  return "resolves";
};

/**
 * - blocked: a known block answer
 * - cancelled: the check was cancelled before it answered
 * - failed: it didn't answer
 * - inspected: sent through Cisco's inspection proxy rather than blocked
 * - missing: says the name doesn't exist
 * - optional: a filter that needn't answer here didn't, such as an ISP's
 *   filter off its network
 * - pending: still being asked
 * - redirected: failed the self-test, so its answers seem to come from
 *   another resolver
 * - resolves: an ordinary answer
 * - unsure: says the name doesn't exist, but the real answer is unavailable
 */
export type ResolverState =
  | "blocked"
  | "cancelled"
  | "failed"
  | "inspected"
  | "missing"
  | "optional"
  | "pending"
  | "redirected"
  | "resolves"
  | "unsure";

/** The rows every other row is read against, and the section they are in. */
export const referenceSection = {
  realAnswer: "Real answer",
  system: "Your DNS",
  title: "REFERENCE",
} as const;

/** A filter's row. */
export const filterState = (r: CheckResult, f: FilterResult): ResolverState => {
  const o = f.outcome;
  if (o.kind !== "answered") {
    if (o.kind === "failed" && !shouldAnswer(r, f.filter)) {
      return "optional";
    }
    return o.kind;
  }
  // Only an answer can come from another resolver; no answer is just that.
  if (isRedirected(r, f.filter)) {
    return "redirected";
  }
  const state = answerState(o.verdict);
  // A filter's "doesn't exist" can only be judged against the real answer.
  if (state === "missing" && realAnswerUnavailable(r)) {
    return "unsure";
  }
  return state;
};

/**
 * The "Your DNS" row. It is never unsure: this computer's resolver only
 * says it found no address, not that the name doesn't exist.
 */
export const systemState = (r: CheckResult): ResolverState => {
  if (r.system.kind !== "answered") {
    return r.system.kind;
  }
  return answerState(r.system.verdict);
};

/** The "Real answer" row. */
export const realAnswerState = (r: CheckResult): ResolverState => {
  if (r.realAnswer.kind !== "answered") {
    return r.realAnswer.kind;
  }
  if (r.realAnswer.exists) {
    return "resolves";
  }
  return "missing";
};
