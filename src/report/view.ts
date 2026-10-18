/**
 * Turns a check result into rows and sections, shared by the terminal
 * interface and plain text output.
 */
import { describe, type Verdict } from "../check/classify.ts";
import type { Category, Filter } from "../check/filters.ts";
import {
  type CheckResult,
  type Outcome,
  shouldAnswer,
  truthCancelled,
  wasCancelled,
} from "../check/result.ts";
import { type StatusKind, statusOf, statusText } from "./status.ts";

const maxAnswers = 2;
const maxTruth = 4;

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
  if (wasCancelled(o)) {
    return {
      icon: "–",
      name,
      text: "cancelled before it answered",
      tone: "dim",
    };
  }
  if (filter?.onlyAnswers !== undefined && !shouldAnswer(r, filter)) {
    return {
      icon: "?",
      name,
      text: `no answer (it only answers ${filter.onlyAnswers})`,
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
  if (r.truthExchange === undefined) {
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

const summaryLooks: Record<StatusKind, { icon: string; tone: Tone }> = {
  blocked: { icon: "✗", tone: "blocked" },
  "blocked-here": { icon: "✗", tone: "blocked" },
  cancelled: { icon: "?", tone: "warn" },
  "cant-tell": { icon: "?", tone: "warn" },
  error: { icon: "?", tone: "warn" },
  inspected: { icon: "!", tone: "warn" },
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

const truthRow = (r: CheckResult): Row => {
  const name = "Real answer";
  if (truthCancelled(r)) {
    return {
      icon: "–",
      name,
      text: "cancelled before it answered",
      tone: "dim",
    };
  }
  if (r.truthError !== undefined) {
    return {
      icon: "?",
      name,
      text: `could not reach an unfiltered resolver: ${r.truthError}`,
      tone: "warn",
    };
  }
  if (r.truthExchange === undefined) {
    return { icon: "…", name, text: "asking…", tone: "dim" };
  }
  if (!r.exists) {
    return { icon: "–", name, text: "the domain doesn't exist", tone: "dim" };
  }
  if (r.truth.length === 0) {
    return {
      icon: "✓",
      name,
      text: "the domain exists, but has no addresses",
      tone: "plain",
    };
  }
  return { icon: "✓", name, text: shortList(r.truth, maxTruth), tone: "plain" };
};

const filterSections = (r: CheckResult): Section[] =>
  categoryOrder
    .map((category) => ({
      lines: [],
      rows: r.filters
        .filter((f) => f.filter.category === category)
        .map((f) => outcomeRow(f.filter.name, f.outcome, r, f.filter)),
      title: categoryTitles[category],
    }))
    .filter((s) => s.rows.length > 0);

export const categoryTitles: Record<Category, string> = {
  ads: "ADS AND TRACKERS",
  family: "FAMILY · SECURITY + ADULT CONTENT",
  security: "SECURITY · MALWARE, PHISHING",
};

export const categoryOrder: readonly Category[] = ["security", "family", "ads"];

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
  readonly lines: readonly Line[];
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
  const reference: Row[] = [];
  if (r.system !== undefined) {
    reference.push(outcomeRow("Your DNS", r.system, r));
  }
  reference.push(truthRow(r));
  return {
    ...base,
    sections: [
      { lines: [], rows: reference, title: "REFERENCE" },
      ...filterSections(r),
    ],
  };
};
