/**
 * Turns a check result into rows and sections, shared by the terminal
 * interface and plain text output.
 */
import { describe, type Verdict } from "../check/classify.ts";
import { isRedirected, shouldAnswer } from "../check/evidence.ts";
import type { Filter } from "../check/filters.ts";
import {
  type CheckResult,
  type Outcome,
  realAnswerKnown,
} from "../check/result.ts";
import { byCategory } from "./categories.ts";
import { type StatusKind, statusOf, statusText } from "./status.ts";

const maxAnswers = 2;
const maxRealAddresses = 4;

/** The answers worth showing next to a block, such as the block page. */
const blockDetail = (v: Verdict): string => {
  if (v.reason === "null-ip") {
    return "";
  }
  return shortList(v.answers, maxAnswers);
};

type Failed = Extract<Outcome, { readonly kind: "failed" }>;

const failedRow = (
  name: string,
  o: Failed,
  r: CheckResult,
  filter: Filter | undefined
): Row => {
  if (filter?.onlyAnswers !== undefined && !shouldAnswer(r, filter)) {
    return {
      icon: "?",
      name,
      text: `no answer (it only answers ${filter.onlyAnswers.customers})`,
      tone: "dim",
    };
  }
  return { detail: o.error, icon: "?", name, text: "no answer", tone: "warn" };
};

/** The row for an answer that says the name doesn't exist. */
const missingRow = (
  name: string,
  v: Verdict,
  r: CheckResult,
  system: boolean
): Row => {
  if (system) {
    return {
      icon: "–",
      name,
      text: "no address on this computer",
      tone: "dim",
    };
  }
  if (!realAnswerKnown(r)) {
    return {
      icon: "?",
      name,
      text: "says the domain doesn't exist; can't tell without the real answer",
      tone: "warn",
    };
  }
  return { icon: "–", name, text: describe(v), tone: "dim" };
};

const outcomeRow = (
  name: string,
  outcome: Outcome,
  r: CheckResult,
  filter?: Filter
): Row => {
  if (outcome.kind === "pending") {
    return { icon: "…", name, text: "asking…", tone: "dim" };
  }
  if (outcome.kind === "cancelled") {
    return {
      icon: "–",
      name,
      text: "cancelled before it answered",
      tone: "dim",
    };
  }
  if (outcome.kind === "failed") {
    return failedRow(name, outcome, r, filter);
  }
  const v = outcome.verdict;
  if (v.blocked) {
    return {
      detail: blockDetail(v),
      icon: "✗",
      name,
      text: describe(v),
      tone: "blocked",
    };
  }
  if (v.inspected) {
    return {
      detail: shortList(v.answers, maxAnswers),
      icon: "!",
      name,
      text: describe(v),
      tone: "warn",
    };
  }
  if (v.missing) {
    return missingRow(name, v, r, filter === undefined);
  }
  return { icon: "✓", name, text: describe(v), tone: "ok" };
};

/**
 * The row of a filter that failed the self-test: its answers seem to come
 * from another resolver, so they say nothing about the filter.
 */
const redirectedRow = (name: string, outcome: Outcome): Row => {
  let detail = "";
  if (outcome.kind === "answered") {
    detail = shortList(outcome.verdict.answers, maxAnswers);
  }
  return {
    detail,
    icon: "?",
    name,
    text: `answers don't look like they come from ${name}: DNS may be redirected on this network`,
    tone: "warn",
  };
};

const filterRow = (r: CheckResult, filter: Filter, outcome: Outcome): Row => {
  // Only an answer can come from another resolver; no answer is just that.
  if (outcome.kind === "answered" && isRedirected(r, filter)) {
    return redirectedRow(filter.name, outcome);
  }
  return outcomeRow(filter.name, outcome, r, filter);
};

const summaryLooks: Record<StatusKind, { icon: string; tone: Tone }> = {
  blocked: { icon: "✗", tone: "blocked" },
  "blocked-here": { icon: "✗", tone: "blocked" },
  cancelled: { icon: "?", tone: "warn" },
  "cant-tell": { icon: "?", tone: "warn" },
  error: { icon: "?", tone: "warn" },
  inspected: { icon: "!", tone: "warn" },
  intercepted: { icon: "?", tone: "warn" },
  "local-only": { icon: "–", tone: "dim" },
  missing: { icon: "–", tone: "dim" },
  "no-answer": { icon: "?", tone: "warn" },
  "not-blocked": { icon: "✓", tone: "ok" },
  unchecked: { icon: "", tone: "dim" },
};

const summaryOf = (r: CheckResult): Line => {
  const status = statusOf(r);
  const { icon, tone } = summaryLooks[status.kind];
  return { text: [icon, statusText(status)].filter(Boolean).join(" "), tone };
};

const realAnswerRow = (r: CheckResult): Row => {
  const name = "Real answer";
  const o = r.realAnswer;
  if (o.kind === "cancelled") {
    return {
      icon: "–",
      name,
      text: "cancelled before it answered",
      tone: "dim",
    };
  }
  if (o.kind === "failed") {
    return {
      icon: "?",
      name,
      text: `could not reach an unfiltered resolver: ${o.error}`,
      tone: "warn",
    };
  }
  if (o.kind === "pending") {
    return { icon: "…", name, text: "asking…", tone: "dim" };
  }
  if (!o.exists) {
    return { icon: "–", name, text: "the domain doesn't exist", tone: "dim" };
  }
  if (o.addresses.length === 0) {
    return {
      icon: "✓",
      name,
      text: "the domain exists, but has no addresses",
      tone: "plain",
    };
  }
  return {
    icon: "✓",
    name,
    text: shortList(o.addresses, maxRealAddresses),
    tone: "plain",
  };
};

const filterSections = (r: CheckResult): Section[] =>
  byCategory(
    r.filters,
    (f) => f.filter.category,
    (f) => filterRow(r, f.filter, f.outcome)
  );

export type Tone = "blocked" | "dim" | "ok" | "plain" | "warn";

export interface Line {
  readonly text: string;
  readonly tone: Tone;
}

export interface Row {
  /** Answers worth showing, such as the block page's CNAME. */
  readonly detail?: string;
  readonly icon: string;
  readonly name: string;
  readonly text: string;
  readonly tone: Tone;
}

export interface Section {
  readonly rows: readonly Row[];
  readonly title: string;
}

export interface View {
  readonly host: string;
  readonly notes: readonly string[];
  readonly sections: readonly Section[];
  readonly summary: Line;
}

/** Joins the first n items and counts the rest, so long lists fit a line. */
export const shortList = (items: readonly string[], n: number): string => {
  if (items.length <= n) {
    return items.join(", ");
  }
  return `${items.slice(0, n).join(", ")} and ${items.length - n} more`;
};

export const view = (r: CheckResult): View => {
  const base = { host: r.host, notes: r.notes, summary: summaryOf(r) };
  if (!r.checked) {
    return { ...base, sections: [] };
  }
  const reference = [outcomeRow("Your DNS", r.system, r), realAnswerRow(r)];
  return {
    ...base,
    sections: [{ rows: reference, title: "REFERENCE" }, ...filterSections(r)],
  };
};
