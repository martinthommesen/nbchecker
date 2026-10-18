/** Draws the resolvers table and the details pane. */
import type { StyledText, TextChunk } from "@opentui/core";
import { lines, paint, spinner } from "./paint.ts";
import type { Group, RowState, TableRow } from "./rows.ts";
import { columns, fit, fitRight, wrap } from "./text-layout.ts";
import { theme } from "./theme.ts";

const glyphWidth = 2;
const nameWidth = 23;
const verdictWidth = 10;
const msWidth = 4;
const gaps = 1;
const labelWidth = 11;
/** Response lines start one column in, and wrap two further in. */
const responseIndent = 1;
const responseHang = 2;

const looks: Record<
  RowState,
  { readonly color: string; readonly glyph: string }
> = {
  blocked: { color: theme.block, glyph: "✕" },
  failed: { color: theme.warn, glyph: "?" },
  idle: { color: theme.faint, glyph: "·" },
  inspected: { color: theme.warn, glyph: "!" },
  missing: { color: theme.dim, glyph: "–" },
  pending: { color: theme.dim, glyph: "" },
  redirected: { color: theme.warn, glyph: "?" },
  resolves: { color: theme.ok, glyph: "✓" },
  unavailable: { color: theme.faint, glyph: "·" },
  unsure: { color: theme.warn, glyph: "?" },
};

const answerWidth = (width: number): number =>
  width - glyphWidth - nameWidth - verdictWidth - msWidth - gaps;

/** The glyph and colour a row is drawn with. */
const lookOf = (state: RowState, tick: number) => {
  const look = looks[state];
  if (state === "pending") {
    return { ...look, glyph: spinner(tick) };
  }
  return look;
};

const rowLine = (
  row: TableRow,
  width: number,
  tick: number,
  selected: boolean
): TextChunk[] => {
  const { color, glyph } = lookOf(row.state, tick);
  const back: { bg?: string } = {};
  if (selected) {
    back.bg = theme.selected;
  }
  const answer = answerWidth(width);
  return [
    paint(fit(glyph, glyphWidth), { ...back, fg: color }),
    paint(fit(row.name, nameWidth), { ...back, bold: selected }),
    paint(fit(row.verdict, verdictWidth), { ...back, fg: color }),
    paint(`${fit(row.answer, answer)} `, { ...back, fg: theme.answer }),
    paint(` ${fitRight(row.ms, msWidth - 1)}`, { ...back, fg: theme.dim }),
  ];
};

const field = (label: string, value: string): TextChunk[] => [
  paint(fit(label, labelWidth), { fg: theme.dim }),
  paint(value),
];

/** The column titles above the table. */
export const tableHeader = (width: number): StyledText =>
  lines([
    [
      paint(
        `${" ".repeat(glyphWidth)}${fit("resolver", nameWidth)}${fit("verdict", verdictWidth)}${fit("answer", answerWidth(width) + 1)}${fitRight("ms", msWidth)}`,
        { fg: theme.faint }
      ),
    ],
  ]);

/** The table, and which line the selected row is on so it can be kept in view. */
export const tableText = (
  groups: readonly Group[],
  selected: number,
  width: number,
  tick: number
): { readonly selectedLine: number; readonly text: StyledText } => {
  const out: TextChunk[][] = [];
  let index = 0;
  let selectedLine = 0;
  for (const [i, g] of groups.entries()) {
    if (i > 0) {
      out.push([]);
    }
    out.push([paint(g.title, { fg: theme.faint })]);
    for (const row of g.rows) {
      if (index === selected) {
        selectedLine = out.length;
      }
      out.push(rowLine(row, width, tick, index === selected));
      index += 1;
    }
  }
  return { selectedLine, text: lines(out) };
};

/** The details pane for the selected row. */
export const detailsText = (
  row: TableRow | undefined,
  host: string,
  width: number,
  tick: number
): StyledText => {
  if (row === undefined) {
    return lines([]);
  }
  const { color, glyph } = lookOf(row.state, tick);
  const verdict = `${glyph} ${row.verdict}`.trim();
  const out: TextChunk[][] = [
    [
      paint(fit(row.name, Math.max(width - columns(verdict), 1)), {
        bold: true,
      }),
      paint(verdict, { fg: color }),
    ],
    [],
    field("category", row.category),
    field("server", row.server),
    field("transport", row.transport),
  ];
  if (host !== "") {
    out.push(field("query", `A + AAAA ${host}`));
  }
  if (row.response.length > 0) {
    const block = { bg: theme.response };
    out.push(
      [],
      [paint(fit(" RESPONSE", width), { ...block, fg: theme.faint })]
    );
    // Wrapped, not cut: the exact address is what the details are for.
    for (const line of row.response) {
      for (const part of wrap(line, width - responseIndent, responseHang)) {
        out.push([
          paint(fit(` ${part}`, width), { ...block, fg: theme.answer }),
        ]);
      }
    }
  }
  out.push([], [paint("WHY", { fg: theme.faint })], [paint(row.why)]);
  return lines(out);
};

export { lookOf };
