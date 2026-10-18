/**
 * The main screen: the input, the summary under it, and the resolvers table
 * beside the details of the selected row.
 */
import {
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  type ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import type { Filter } from "../check/filters.ts";
import { lines, paint } from "./paint.ts";
import { flatRows } from "./rows.ts";
import type { State } from "./state.ts";
import { inputHint, summaryText } from "./summary.ts";
import { detailsText, tableGroups, tableHeader, tableText } from "./table.ts";
import { theme } from "./theme.ts";
import {
  addAll,
  bodyOf,
  inner,
  type Layout,
  linePaneHeight,
  pane,
  paneChrome,
  paneGap,
  scrollBox,
  text,
} from "./widgets.ts";

/** The input keeps room for a domain however long the hint beside it is. */
const inputLeast = 20;
const detailsLeast = 36;
/** The table gets twice the width of the details pane. */
const tableShare = 2;
/** Room for the table's scroll bar. */
const scrollBar = 2;

const buildInput = (renderer: CliRenderer) => {
  const box = pane(renderer, {
    color: theme.accent,
    flexGrow: 0,
    title: "Domain or IP",
  });
  box.flexDirection = "row";
  box.height = linePaneHeight;
  box.flexShrink = 0;
  const prompt = new TextRenderable(renderer, {
    content: lines([[paint("› ", { fg: theme.accent })]]),
    flexShrink: 0,
  });
  const input = new InputRenderable(renderer, {
    backgroundColor: theme.background,
    cursorColor: theme.text,
    flexGrow: 1,
    focusedBackgroundColor: theme.background,
    focusedTextColor: theme.text,
    placeholder: "a domain, URL or IP address",
    placeholderColor: theme.faint,
    textColor: theme.text,
  });
  input.minWidth = inputLeast;
  // On a narrow screen the hint is cut, not what was typed.
  const hint = text(renderer);
  hint.wrapMode = "none";
  hint.flexShrink = 1;
  hint.overflow = "hidden";
  addAll(box, [prompt, input, hint]);
  return { box, hint, input };
};

const buildResults = (renderer: CliRenderer) => {
  // The results give up their height first, so the keys below stay on screen.
  const row = new BoxRenderable(renderer, {
    columnGap: paneGap,
    flexDirection: "row",
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    overflow: "hidden",
  });
  const resolvers = pane(renderer, { title: "Resolvers" });
  resolvers.flexShrink = 1;
  resolvers.overflow = "hidden";
  const head = text(renderer);
  head.flexShrink = 0;
  const scroll = scrollBox(renderer);
  const table = bodyOf(renderer, scroll);
  addAll(resolvers, [head, scroll]);
  const details = pane(renderer, { flexGrow: 0, title: "Details" });
  details.overflow = "hidden";
  const detailsBody = bodyOf(renderer, details);
  addAll(row, [resolvers, details]);
  return { details, detailsBody, head, row, scroll, table };
};

/** Until a check has a result, the table lists the filters in `items`. */
const buildMain = (renderer: CliRenderer, items: readonly Filter[]) => {
  const entry = buildInput(renderer);
  const summary = text(renderer);
  summary.flexShrink = 0;
  const results = buildResults(renderer);
  return { entry, items, results, summary };
};

type MainParts = ReturnType<typeof buildMain>;

/** The input is outlined in the accent colour except while a check runs. */
const drawInput = (entry: MainParts["entry"], s: State) => {
  entry.hint.content = inputHint(s);
  let color: string = theme.accent;
  if (s.checking) {
    color = theme.border;
  }
  entry.box.borderColor = color;
  entry.box.titleColor = color;
};

/** Keeps `line` within the visible part of `scroll`. */
const keepInView = (scroll: ScrollBoxRenderable, line: number): void => {
  const { height } = scroll.viewport;
  if (line <= scroll.scrollTop) {
    scroll.scrollTop = Math.max(line - 1, 0);
  } else if (height > 0 && line >= scroll.scrollTop + height) {
    scroll.scrollTop = line - height + 1;
  }
};

/** How wide the details pane is: its share of the width, but no less. */
const detailsWidthOf = (width: number): number =>
  Math.max(
    detailsLeast,
    Math.round((inner(width) - paneGap) / (tableShare + 1))
  );

/** The width inside the resolvers pane, beside the details pane if shown. */
const tableWidthOf = (
  { wide, width }: Layout,
  detailsWidth: number
): number => {
  let tableWidth = inner(width) - paneChrome - scrollBar;
  if (wide) {
    tableWidth -= detailsWidth + paneGap;
  }
  return tableWidth;
};

const drawResults = (
  { items, results }: MainParts,
  s: State,
  layout: Layout
) => {
  const detailsWidth = detailsWidthOf(layout.width);
  results.details.visible = layout.wide;
  results.details.width = detailsWidth;
  const tableWidth = tableWidthOf(layout, detailsWidth);
  const groups = tableGroups(s, items);
  const table = tableText(groups, s.selected, tableWidth, s.tick);
  results.head.content = tableHeader(tableWidth);
  results.table.content = table.text;
  keepInView(results.scroll, table.selectedLine);
  results.detailsBody.content = detailsText(
    flatRows(groups)[s.selected],
    s.result?.host ?? "",
    detailsWidth - paneChrome,
    s.tick
  );
};

const drawMain = (parts: MainParts, s: State, layout: Layout) => {
  drawInput(parts.entry, s);
  parts.summary.content = summaryText(s, layout.wide);
  drawResults(parts, s, layout);
};

export { buildMain, drawMain };
