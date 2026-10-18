/** Turns a check result into the grouped rows of the resolvers table. */
import type { Filter } from "../check/filters.ts";
import type { CheckResult, FilterResult, Outcome } from "../check/result.ts";
import { systemServer } from "../check/system.ts";
import { answerSummary, responseLines } from "../report/answer.ts";
import { byCategory, categoryLabels } from "../report/categories.ts";
import {
  filterState,
  type ResolverState,
  realAnswerState,
  referenceSection,
  systemState,
} from "../report/resolver-state.ts";
import { filterWhy, realAnswerWhy, systemWhy } from "../report/why.ts";

const words: Record<RowState, string> = {
  blocked: "blocked",
  cancelled: "cancelled",
  failed: "no answer",
  idle: "",
  inspected: "inspected",
  missing: "not found",
  optional: "no answer",
  pending: "asking…",
  redirected: "untrusted",
  resolves: "resolves",
  unsure: "can't tell",
};

/** This computer finding no address doesn't say the name doesn't exist. */
const systemWords: Record<RowState, string> = {
  ...words,
  missing: "no address",
};

interface RowBase {
  readonly category: string;
  readonly name: string;
  readonly server: string;
  readonly transport: string;
}

/** What the details show of how asking a resolver went. */
const lookupFields = (o: Outcome) => {
  if (o.kind === "answered") {
    return {
      answer: answerSummary(o.exchange.answers, o.verdict.reason),
      ms: String(o.exchange.ms),
      response: [
        ...responseLines(o.exchange.answers),
        ...(o.exchange.notes ?? []),
      ],
      server: o.exchange.server,
    };
  }
  if (o.kind === "failed") {
    return { answer: "", ms: String(o.ms), response: [`error: ${o.error}`] };
  }
  if (o.kind === "cancelled") {
    // The details read like a lookup that failed at once with this error.
    return { answer: "", ms: "0", response: ["error: cancelled"] };
  }
  return { answer: "", ms: "", response: [] };
};

const filterBase = (f: Filter): RowBase => ({
  category: categoryLabels[f.category].name,
  name: f.name,
  server: f.servers[0] ?? "",
  transport: "UDP 53",
});

const filterRow = (r: CheckResult, f: FilterResult): TableRow => {
  const state = filterState(r, f);
  return {
    ...filterBase(f.filter),
    ...lookupFields(f.outcome),
    state,
    why: filterWhy(f.filter, f.outcome, r),
    word: words[state],
  };
};

const systemRow = (r: CheckResult): TableRow => {
  const state = systemState(r);
  return {
    category: "reference",
    name: referenceSection.system,
    server: systemServer,
    transport: "system resolver",
    ...lookupFields(r.system),
    state,
    why: systemWhy(r.system, r),
    word: systemWords[state],
  };
};

/** The real answer's server is shown by its host, and only once it answered. */
const realAnswerRow = (r: CheckResult): TableRow => {
  const state = realAnswerState(r);
  const row: TableRow = {
    answer: "",
    category: "reference",
    ms: "",
    name: referenceSection.realAnswer,
    response: [],
    server: "DNS over HTTPS",
    state,
    transport: "HTTPS 443",
    why: realAnswerWhy(r),
    word: words[state],
  };
  const o = r.realAnswer;
  if (o.kind === "answered") {
    return {
      ...row,
      answer: answerSummary(o.exchange.answers),
      ms: String(o.exchange.ms),
      response: responseLines(o.exchange.answers),
      server: new URL(o.exchange.server).host,
    };
  }
  if (o.kind === "failed") {
    return { ...row, response: [`error: ${o.error}`] };
  }
  return row;
};

const idleRow = (f: Filter): TableRow => ({
  ...filterBase(f),
  answer: f.servers[0] ?? "",
  ms: "",
  response: [],
  state: "idle",
  why: "Not checked yet. Type a domain, URL or IP address and press enter.",
  word: "",
});

/** The table before anything is checked: the filters that will be asked. */
const idleGroups = (items: readonly Filter[]): Group[] =>
  byCategory(items, (f) => f.category, idleRow);

/** The table for a result, complete or still arriving. */
const resultGroups = (r: CheckResult): Group[] => {
  if (!r.checked) {
    return [];
  }
  const reference = {
    rows: [systemRow(r), realAnswerRow(r)],
    title: referenceSection.title,
  };
  return [
    reference,
    ...byCategory(
      r.filters,
      (f) => f.filter.category,
      (f) => filterRow(r, f)
    ),
  ];
};

/** A resolver's state, or "idle" for a filter before anything is checked. */
export type RowState = ResolverState | "idle";

/** One row of the table, with everything the details pane shows. */
export interface TableRow extends RowBase {
  readonly answer: string;
  readonly ms: string;
  readonly response: readonly string[];
  readonly state: RowState;
  readonly why: string;
  /** The state in a word, such as "blocked". */
  readonly word: string;
}

export interface Group {
  readonly rows: readonly TableRow[];
  readonly title: string;
}

/**
 * The table's groups of rows: those of `result`, or until a check has one,
 * the filters in `items` that will be asked. The selection moves through
 * the same rows.
 */
export const tableGroups = (
  result: CheckResult | undefined,
  items: readonly Filter[]
): Group[] => {
  if (result === undefined) {
    return idleGroups(items);
  }
  return resultGroups(result);
};

/** All rows in table order, for moving the selection. */
export const flatRows = (groups: readonly Group[]): TableRow[] =>
  groups.flatMap((g) => g.rows);
