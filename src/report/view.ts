/**
 * Turns a check result into rows and sections, shared by the terminal
 * interface and plain text output.
 */
import { describe } from "../check/classify.ts";
import type { Category, Filter } from "../check/filters.ts";
import type { CheckResult, Outcome } from "../check/result.ts";

const maxAnswers = 2;
const maxTruth = 4;

const failedText = (filter: Filter | undefined): string => {
  if (filter?.onlyAnswers === undefined) {
    return "no answer";
  }
  return `no answer (it only answers ${filter.onlyAnswers})`;
};

const outcomeRow = (name: string, outcome: Outcome, filter?: Filter): Row => {
  if (outcome.kind === "pending") {
    return { icon: "…", name, text: "asking…", tone: "dim" };
  }
  if (outcome.kind === "failed") {
    let tone: Tone = "warn";
    if (filter?.onlyAnswers !== undefined) {
      tone = "dim";
    }
    return { icon: "?", name, text: failedText(filter), tone };
  }
  const v = outcome.verdict;
  if (v.blocked) {
    return {
      detail: shortList(v.answers, maxAnswers),
      icon: "✗",
      name,
      text: describe(v),
      tone: "blocked",
    };
  }
  if (v.missing) {
    return { icon: "–", name, text: describe(v), tone: "dim" };
  }
  return { icon: "✓", name, text: describe(v), tone: "ok" };
};

const counts = (r: CheckResult) => {
  let blocked = 0;
  let answered = 0;
  for (const f of r.filters) {
    if (f.outcome.kind === "answered") {
      answered += 1;
      if (f.outcome.verdict.blocked) {
        blocked += 1;
      }
    }
  }
  return { answered, blocked };
};

const systemBlocks = (r: CheckResult): boolean =>
  r.system?.kind === "answered" && r.system.verdict.blocked;

const summaryOf = (r: CheckResult): Line => {
  if (r.lookupError !== undefined) {
    return { text: "? could not check", tone: "warn" };
  }
  if (!r.checked) {
    return { text: "nothing to check", tone: "dim" };
  }
  const { answered, blocked } = counts(r);
  if (blocked > 0) {
    return {
      text: `✗ blocked by ${blocked} of ${r.filters.length} filters`,
      tone: "blocked",
    };
  }
  if (systemBlocks(r)) {
    return {
      text: "✗ blocked by your own DNS, but by none of the filters",
      tone: "blocked",
    };
  }
  if (r.truthError === undefined && !r.exists) {
    return { text: "– the domain doesn't exist", tone: "dim" };
  }
  if (answered === 0) {
    return { text: "? no filter answered", tone: "warn" };
  }
  return { text: `✓ not blocked by any of ${answered} filters`, tone: "ok" };
};

const truthLine = (r: CheckResult): Line => {
  if (r.truthError !== undefined) {
    return {
      text: `could not reach an unfiltered resolver: ${r.truthError}`,
      tone: "warn",
    };
  }
  if (!r.exists) {
    return { text: "the domain doesn't exist", tone: "plain" };
  }
  return { text: shortList(r.truth, maxTruth), tone: "plain" };
};

const filterSections = (r: CheckResult): Section[] =>
  categoryOrder
    .map((category) => ({
      lines: [],
      rows: r.filters
        .filter((f) => f.filter.category === category)
        .map((f) => outcomeRow(f.filter.name, f.outcome, f.filter)),
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
  const sections: Section[] = [...filterSections(r)];
  if (r.system !== undefined) {
    sections.push({
      lines: [],
      rows: [outcomeRow("Your DNS", r.system)],
      title: "THIS COMPUTER",
    });
  }
  sections.push({ lines: [truthLine(r)], rows: [], title: "REAL ANSWER" });
  return { ...base, sections };
};
