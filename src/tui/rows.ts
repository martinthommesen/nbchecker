/** Turns a check result into the grouped rows of the resolvers table. */

import { isRedirected, shouldAnswer } from "../check/evidence.ts";
import type { Filter } from "../check/filters.ts";
import {
  type CheckResult,
  type Outcome,
  realAnswerUnavailable,
} from "../check/result.ts";
import { answerSummary, responseLines } from "../report/answer.ts";
import { byCategory, categoryLabels } from "../report/categories.ts";
import { filterWhy, realAnswerWhy, systemWhy } from "./why.ts";

const verdictWords: Record<RowState, string> = {
  blocked: "blocked",
  failed: "no answer",
  idle: "",
  inspected: "inspected",
  missing: "not found",
  pending: "asking…",
  redirected: "untrusted",
  resolves: "resolves",
  unavailable: "no answer",
  unsure: "can't tell",
};

interface RowBase {
  readonly category: string;
  readonly name: string;
  readonly server: string;
  readonly transport: string;
}

/** How a row is asked about: by a filter, or this computer. */
interface RowContext {
  /** It needn't answer, as an ISP's filter elsewhere. */
  readonly optional: boolean;
  /** It failed the self-test, so its answers don't count. */
  readonly redirected: boolean;
  readonly result: CheckResult;
  readonly system: boolean;
}

const stateOf = (o: Outcome, c: RowContext): RowState => {
  if (o.kind === "pending") {
    return "pending";
  }
  if (o.kind === "cancelled") {
    return "unavailable";
  }
  if (c.redirected && o.kind === "answered") {
    return "redirected";
  }
  if (o.kind === "failed" && c.optional) {
    return "unavailable";
  }
  if (o.kind === "failed") {
    return "failed";
  }
  if (o.verdict.blocked) {
    return "blocked";
  }
  if (o.verdict.inspected) {
    return "inspected";
  }
  // A filter's "doesn't exist" can only be judged against the real answer.
  if (o.verdict.missing && !c.system && realAnswerUnavailable(c.result)) {
    return "unsure";
  }
  if (o.verdict.missing) {
    return "missing";
  }
  return "resolves";
};

const wordOf = (state: RowState, o: Outcome, c: RowContext): string => {
  if (o.kind === "cancelled") {
    return "cancelled";
  }
  if (state === "missing" && c.system) {
    return "no address";
  }
  return verdictWords[state];
};

const outcomeRow = (
  base: RowBase,
  o: Outcome,
  why: string,
  c: RowContext
): TableRow => {
  const state = stateOf(o, c);
  const row = { ...base, state, verdict: wordOf(state, o, c), why };
  if (o.kind === "answered") {
    return {
      ...row,
      answer: answerSummary(o.exchange.answers, o.verdict),
      ms: String(o.exchange.ms),
      response: [
        ...responseLines(o.exchange.answers),
        ...(o.exchange.notes ?? []),
      ],
      server: o.exchange.server,
    };
  }
  if (o.kind === "failed") {
    return {
      ...row,
      answer: "",
      ms: String(o.ms),
      response: [`error: ${o.error}`],
    };
  }
  if (o.kind === "cancelled") {
    // The details read like a lookup that failed at once with this error.
    return { ...row, answer: "", ms: "0", response: ["error: cancelled"] };
  }
  return { ...row, answer: "", ms: "", response: [] };
};

const realAnswerRow = (r: CheckResult): TableRow => {
  const base = {
    category: "reference",
    name: "Real answer",
    server: "DNS over HTTPS",
    transport: "HTTPS 443",
    why: realAnswerWhy(r),
  };
  const o = r.realAnswer;
  if (o.kind === "answered") {
    const { exchange: ex, exists } = o;
    let state: RowState = "resolves";
    if (!exists) {
      state = "missing";
    }
    const verdict = {
      answers: o.addresses,
      blocked: false,
      detail: "",
      inspected: false,
      missing: !exists,
      reason: undefined,
    };
    return {
      ...base,
      answer: answerSummary(ex.answers, verdict),
      ms: String(ex.ms),
      response: responseLines(ex.answers),
      server: new URL(ex.server).host,
      state,
      verdict: verdictWords[state],
    };
  }
  let state: RowState = "pending";
  let verdict = verdictWords.pending;
  let response: string[] = [];
  if (o.kind === "cancelled") {
    state = "unavailable";
    verdict = "cancelled";
  } else if (o.kind === "failed") {
    state = "failed";
    verdict = verdictWords.failed;
    response = [`error: ${o.error}`];
  }
  return { ...base, answer: "", ms: "", response, state, verdict };
};

const filterBase = (f: Filter): RowBase => ({
  category: categoryLabels[f.category].name,
  name: f.name,
  server: f.servers[0] ?? "",
  transport: "UDP 53",
});

const idleRow = (f: Filter): TableRow => ({
  ...filterBase(f),
  answer: f.servers[0] ?? "",
  ms: "",
  response: [],
  state: "idle",
  verdict: "",
  why: "Not checked yet. Type a domain, URL or IP address and press enter.",
});

export type RowState =
  | "blocked"
  | "failed"
  | "idle"
  | "inspected"
  | "missing"
  | "pending"
  /** Failed the self-test: its answers seem to come from another resolver. */
  | "redirected"
  | "resolves"
  | "unavailable"
  /** Says the name doesn't exist, but the real answer is unavailable. */
  | "unsure";

/** One row of the table, with everything the details pane shows. */
export interface TableRow extends RowBase {
  readonly answer: string;
  readonly ms: string;
  readonly response: readonly string[];
  readonly state: RowState;
  readonly verdict: string;
  readonly why: string;
}

export interface Group {
  readonly rows: readonly TableRow[];
  readonly title: string;
}

/** The table before anything is checked: the filters that will be asked. */
export const idleGroups = (items: readonly Filter[]): Group[] =>
  byCategory(items, (f) => f.category, idleRow);

/** The table for a result, complete or still arriving. */
export const resultGroups = (r: CheckResult): Group[] => {
  if (!r.checked) {
    return [];
  }
  const reference: Group = {
    rows: [
      outcomeRow(
        {
          category: "reference",
          name: "Your DNS",
          server: "this computer",
          transport: "system resolver",
        },
        r.system,
        systemWhy(r.system, r),
        { optional: false, redirected: false, result: r, system: true }
      ),
      realAnswerRow(r),
    ],
    title: "REFERENCE",
  };
  return [
    reference,
    ...byCategory(
      r.filters,
      (f) => f.filter.category,
      ({ filter: f, outcome: o }) =>
        outcomeRow(filterBase(f), o, filterWhy(f, o, r), {
          optional: !shouldAnswer(r, f),
          redirected: isRedirected(r, f),
          result: r,
          system: false,
        })
    ),
  ];
};

/** All rows in table order, for moving the selection. */
export const flatRows = (groups: readonly Group[]): TableRow[] =>
  groups.flatMap((g) => g.rows);
