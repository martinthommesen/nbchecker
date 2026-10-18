/** Turns a check result into the grouped rows of the resolvers table. */
import type { Filter } from "../check/filters.ts";
import {
  type CheckResult,
  type Exchange,
  type Outcome,
  truthPending,
} from "../check/result.ts";
import { answerSummary, responseLines } from "../report/answer.ts";
import { categoryOrder, categoryTitles } from "../report/view.ts";
import { filterWhy, systemWhy, truthWhy } from "./why.ts";

const categoryNames = {
  ads: "ads and trackers",
  family: "family",
  security: "security",
} as const;

const verdictWords: Record<RowState, string> = {
  blocked: "blocked",
  failed: "no answer",
  idle: "",
  missing: "not found",
  pending: "asking…",
  resolves: "resolves",
  unavailable: "no answer",
};

interface RowBase {
  readonly category: string;
  readonly name: string;
  readonly server: string;
  readonly transport: string;
}

const stateOf = (o: Outcome, onlySome: boolean): RowState => {
  if (o.kind === "pending") {
    return "pending";
  }
  if (o.kind === "failed" && onlySome) {
    return "unavailable";
  }
  if (o.kind === "failed") {
    return "failed";
  }
  if (o.verdict.blocked) {
    return "blocked";
  }
  if (o.verdict.missing) {
    return "missing";
  }
  return "resolves";
};

const outcomeRow = (
  base: RowBase,
  o: Outcome,
  why: string,
  onlySome = false
): TableRow => {
  const state = stateOf(o, onlySome);
  const row = { ...base, state, verdict: verdictWords[state], why };
  if (o.kind === "answered") {
    return {
      ...row,
      answer: answerSummary(o.exchange.answers, o.verdict),
      ms: String(o.exchange.ms),
      response: responseLines(o.exchange.answers),
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
  return { ...row, answer: "", ms: "", response: [] };
};

const truthRow = (r: CheckResult): TableRow => {
  const base = {
    category: "reference",
    name: "Real answer",
    server: "DNS over HTTPS",
    transport: "HTTPS 443",
    why: truthWhy(r),
  };
  const ex: Exchange | undefined = r.truthExchange;
  if (ex !== undefined) {
    let state: RowState = "resolves";
    if (!r.exists) {
      state = "missing";
    }
    const verdict = {
      answers: r.truth,
      blocked: false,
      detail: "",
      missing: !r.exists,
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
  let response: string[] = [];
  if (!truthPending(r)) {
    state = "failed";
    response = [`error: ${r.truthError ?? ""}`];
  }
  return {
    ...base,
    answer: "",
    ms: "",
    response,
    state,
    verdict: verdictWords[state],
  };
};

const filterBase = (f: Filter): RowBase => ({
  category: categoryNames[f.category],
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

const byCategory = (
  items: readonly Filter[],
  row: (f: Filter, i: number) => TableRow
): Group[] =>
  categoryOrder
    .map((category) => ({
      rows: items.flatMap((f, i) => {
        if (f.category !== category) {
          return [];
        }
        return [row(f, i)];
      }),
      title: categoryTitles[category],
    }))
    .filter((g) => g.rows.length > 0);

export type RowState =
  | "blocked"
  | "failed"
  | "idle"
  | "missing"
  | "pending"
  | "resolves"
  | "unavailable";

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
  byCategory(items, idleRow);

/** The table for a result, complete or still arriving. */
export const resultGroups = (r: CheckResult): Group[] => {
  if (!r.checked) {
    return [];
  }
  const system = r.system ?? { kind: "pending" };
  const reference: Group = {
    rows: [
      outcomeRow(
        {
          category: "reference",
          name: "Your DNS",
          server: "this computer",
          transport: "system resolver",
        },
        system,
        systemWhy(system, r)
      ),
      truthRow(r),
    ],
    title: "REFERENCE",
  };
  const filters = r.filters.map((f) => f.filter);
  return [
    reference,
    ...byCategory(filters, (f, i) => {
      const o = r.filters[i]?.outcome ?? { kind: "pending" };
      return outcomeRow(
        filterBase(f),
        o,
        filterWhy(f, o, r),
        f.onlyAnswers !== undefined
      );
    }),
  ];
};

/** All rows in table order, for moving the selection. */
export const flatRows = (groups: readonly Group[]): TableRow[] =>
  groups.flatMap((g) => g.rows);
