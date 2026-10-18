/**
 * Turns a check result into rows and sections, shared by the terminal
 * interface and plain text output.
 */
import type { Verdict } from "../check/classify.ts";
import type {
  CheckResult,
  FilterResult,
  Outcome,
  RealAnswer,
} from "../check/result.ts";
import { verdictText } from "./reasons.ts";
import {
  filterState,
  type ResolverState,
  realAnswerState,
  referenceSection,
  resultSections,
  systemState,
} from "./resolver-state.ts";
import { type StatusKind, statusOf, statusText } from "./status.ts";

const maxAnswers = 2;
const maxRealAddresses = 4;

interface Look {
  readonly icon: string;
  readonly tone: Tone;
}

/** What a row says, and the answers worth showing after it. */
interface Said {
  readonly detail?: string;
  readonly text: string;
}

const looks: Record<ResolverState, Look> = {
  blocked: { icon: "✗", tone: "blocked" },
  cancelled: { icon: "–", tone: "dim" },
  failed: { icon: "?", tone: "warn" },
  inspected: { icon: "!", tone: "warn" },
  missing: { icon: "–", tone: "dim" },
  optional: { icon: "?", tone: "dim" },
  pending: { icon: "…", tone: "dim" },
  redirected: { icon: "?", tone: "warn" },
  resolves: { icon: "✓", tone: "ok" },
  unsure: { icon: "?", tone: "warn" },
};

/** The real answer is what the others are read against, not a verdict. */
const realAnswerLooks: Record<ResolverState, Look> = {
  ...looks,
  resolves: { icon: "✓", tone: "plain" },
};

/** What a row says while there is nothing to show. */
const waiting = {
  cancelled: "cancelled before it answered",
  pending: "asking…",
} as const;

/** The answers worth showing next to a block, such as the block page. */
const blockDetail = (v: Verdict): string => {
  if (v.reason === "null-ip") {
    return "";
  }
  return shortList(v.answers, maxAnswers);
};

/** What the row of a resolver that answered says, by its state. */
const answerSaid = (state: ResolverState, name: string, v: Verdict): Said => {
  switch (state) {
    case "redirected":
      return {
        detail: shortList(v.answers, maxAnswers),
        text: `answers don't look like they come from ${name}: DNS may be redirected on this network`,
      };
    case "blocked":
      return { detail: blockDetail(v), text: verdictText(v) };
    case "inspected":
      return { detail: shortList(v.answers, maxAnswers), text: verdictText(v) };
    case "unsure":
      return {
        text: "says the domain doesn't exist; can't tell without the real answer",
      };
    default:
      return { text: verdictText(v) };
  }
};

/** What a filter's or this computer's row says, by its state. */
const outcomeSaid = (state: ResolverState, o: Outcome, name: string): Said => {
  if (o.kind === "answered") {
    return answerSaid(state, name, o.verdict);
  }
  if (o.kind === "failed") {
    return { detail: o.error, text: "no answer" };
  }
  return { text: waiting[o.kind] };
};

const filterRow = (r: CheckResult, f: FilterResult): Row => {
  const state = filterState(r, f);
  const { name, onlyAnswers } = f.filter;
  if (state === "optional" && onlyAnswers !== undefined) {
    return {
      ...looks.optional,
      name,
      text: `no answer (it only answers ${onlyAnswers.customers})`,
    };
  }
  return { ...looks[state], ...outcomeSaid(state, f.outcome, name), name };
};

const systemRow = (r: CheckResult): Row => {
  const state = systemState(r);
  const name = referenceSection.system;
  if (state === "missing") {
    return { ...looks.missing, name, text: "no address on this computer" };
  }
  return { ...looks[state], ...outcomeSaid(state, r.system, name), name };
};

const realAnswerSaid = (o: Outcome<RealAnswer>): Said => {
  if (o.kind === "failed") {
    return { text: `could not reach an unfiltered resolver: ${o.error}` };
  }
  if (o.kind !== "answered") {
    return { text: waiting[o.kind] };
  }
  if (!o.exists) {
    return { text: "the domain doesn't exist" };
  }
  if (o.addresses.length === 0) {
    return { text: "the domain exists, but has no addresses" };
  }
  return { text: shortList(o.addresses, maxRealAddresses) };
};

const realAnswerRow = (r: CheckResult): Row => ({
  ...realAnswerLooks[realAnswerState(r)],
  ...realAnswerSaid(r.realAnswer),
  name: referenceSection.realAnswer,
});

const summaryLooks: Record<StatusKind, Look> = {
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

export const view = (r: CheckResult): View => ({
  host: r.host,
  notes: r.notes,
  sections: resultSections(r, {
    filter: filterRow,
    realAnswer: realAnswerRow,
    system: systemRow,
  }),
  summary: summaryOf(r),
});
