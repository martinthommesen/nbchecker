/**
 * The overall verdict of a check, worked out once and shared by the text
 * output, the interactive screen, copied text and JSON, so they agree.
 */
import {
  type CheckResult,
  type Outcome,
  seemsIntercepted,
  trustedFilters,
} from "../check/result.ts";

const answeredWith = (o: Outcome | undefined, test: keyof Flags): boolean =>
  o?.kind === "answered" && o.verdict[test];

interface Flags {
  readonly blocked: boolean;
  readonly inspected: boolean;
  readonly missing: boolean;
}

/** This computer finds addresses for the name, and they aren't a block. */
const resolvesHere = (r: CheckResult): boolean =>
  r.system?.kind === "answered" &&
  !r.system.verdict.missing &&
  !r.system.verdict.blocked;

/** Some answer says the name doesn't exist, which only the real answer can judge. */
const someMissing = (r: CheckResult): boolean =>
  answeredWith(r.system, "missing") ||
  trustedFilters(r).some((f) => answeredWith(f.outcome, "missing"));

const kindOf = (r: CheckResult, s: Omit<Status, "kind">): StatusKind => {
  if (r.lookupError !== undefined) {
    return "error";
  }
  if (!r.checked) {
    return "unchecked";
  }
  if (r.completion === "cancelled") {
    return "cancelled";
  }
  // A filter whose own self-test passed is evidence even on such a network.
  if (s.blocked > 0) {
    return "blocked";
  }
  // So is this computer's own block: it is what this computer gets.
  if (answeredWith(r.system, "blocked")) {
    return "blocked-here";
  }
  if (seemsIntercepted(r.network)) {
    return "intercepted";
  }
  const realAnswerKnown = r.realAnswerExchange !== undefined;
  if (realAnswerKnown && !r.exists && resolvesHere(r)) {
    return "local-only";
  }
  if (realAnswerKnown && !r.exists) {
    return "missing";
  }
  if (!realAnswerKnown && someMissing(r)) {
    return "cant-tell";
  }
  if (s.answered === 0) {
    return "no-answer";
  }
  if (s.inspected > 0 || s.inspectedHere) {
    return "inspected";
  }
  return "not-blocked";
};

/**
 * - blocked: by at least one filter
 * - blocked-here: by this computer's DNS only
 * - cancelled: stopped before every answer arrived
 * - cant-tell: some answer says the name doesn't exist, and without the real
 *   answer that can't be judged
 * - error: the target couldn't be looked up at all
 * - inspected: not blocked, but sent through Cisco's inspection proxy
 * - intercepted: most filters failed the self-test, so DNS on this network
 *   seems to be sent to another resolver and nothing can be trusted
 * - local-only: the real answer says the name doesn't exist, but this
 *   computer resolves it, as with private or split DNS
 * - missing: the name doesn't exist
 * - no-answer: no filter answered
 * - not-blocked: no filter that answered blocks it
 * - unchecked: nothing to check, such as an IP with no reverse name
 */
export type StatusKind =
  | "blocked"
  | "blocked-here"
  | "cancelled"
  | "cant-tell"
  | "error"
  | "inspected"
  | "intercepted"
  | "local-only"
  | "missing"
  | "no-answer"
  | "not-blocked"
  | "unchecked";

export interface Status {
  /** Filters that answered and passed or skipped the self-test. */
  readonly answered: number;
  /** Filters that block the name. */
  readonly blocked: number;
  /** Filters that send the name through an inspection proxy. */
  readonly inspected: number;
  /** This computer's DNS sends it through an inspection proxy. */
  readonly inspectedHere: boolean;
  readonly kind: StatusKind;
  /** Filters that failed the self-test. */
  readonly redirected: number;
  /** Filters whose self-test answered, so passed or failed it. */
  readonly tested: number;
  /** Filters asked. */
  readonly total: number;
}

/** Works out a check's overall verdict. */
export const statusOf = (r: CheckResult): Status => {
  const selfTests = r.network?.selfTests ?? [];
  const answered = trustedFilters(r).filter(
    (f) => f.outcome.kind === "answered"
  );
  const counts = {
    answered: answered.length,
    blocked: answered.filter((f) => answeredWith(f.outcome, "blocked")).length,
    inspected: answered.filter((f) => answeredWith(f.outcome, "inspected"))
      .length,
    inspectedHere: answeredWith(r.system, "inspected"),
    redirected: selfTests.filter((t) => t.result === "redirected").length,
    tested: selfTests.filter(
      (t) => t.result === "passed" || t.result === "redirected"
    ).length,
    total: r.filters.length,
  };
  return { ...counts, kind: kindOf(r, counts) };
};

/** How a status reads in one line of text. */
export const statusText = (s: Status): string => {
  switch (s.kind) {
    case "blocked":
      return `blocked by ${s.blocked} of ${s.answered} filters`;
    case "blocked-here":
      return "blocked by your own DNS, but by none of the filters";
    case "cancelled":
      return `cancelled: ${s.answered} of ${s.total} filters answered first, ${s.blocked} of them blocking`;
    case "cant-tell":
      return "couldn't tell: the real answer is unavailable";
    case "error":
      return "could not check";
    case "inspected":
      if (s.inspected === 0) {
        return "not blocked, but your DNS sends it through Cisco's inspection proxy";
      }
      return `not blocked, but ${s.inspected} of ${s.answered} filters send it through Cisco's inspection proxy`;
    case "intercepted":
      return `DNS on this network seems to be intercepted: ${s.redirected} of ${s.tested} filters failed the self-test, so these results can't be trusted`;
    case "local-only":
      return "only resolves on this computer (private or split DNS)";
    case "missing":
      return "the domain doesn't exist";
    case "no-answer":
      return "no filter answered";
    case "not-blocked":
      return `not blocked by any of ${s.answered} filters`;
    default:
      return "nothing to check";
  }
};
