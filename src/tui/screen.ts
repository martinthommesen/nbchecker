/** The renderables of the interactive screen, redrawn from the state. */
import {
  BoxRenderable,
  type CliRenderer,
  type InputRenderable,
  type ScrollBoxRenderable,
} from "@opentui/core";
import type { Filter } from "../check/filters.ts";
import { buildConnection, drawConnection } from "./connection-screen.ts";
import { footerText } from "./footer.ts";
import {
  buildHeader,
  buildHelp,
  buildInput,
  buildResults,
} from "./main-parts.ts";
import { lines, paint } from "./paint.ts";
import {
  addAll,
  inner,
  type Layout,
  paneChrome,
  paneGap,
  rootPadding,
  text,
} from "./panes.ts";
import { flatRows, idleGroups, resultGroups } from "./rows.ts";
import type { State } from "./state.ts";
import { connectionBadge, inputHint, summaryText } from "./summary.ts";
import { detailsText, tableHeader, tableText } from "./table.ts";
import { theme } from "./theme.ts";

/** Below this height the screen drops its spacing, and then its header. */
const shortHeight = 20;
const tinyHeight = 16;
/** Below this width the details pane is left out. */
const detailsMinWidth = 100;
const detailsLeast = 36;
/** The table gets twice the width of the details pane. */
const tableShare = 2;
/** Room for the table's scroll bar. */
const scrollBar = 2;

/** Keeps `line` within the visible part of `scroll`. */
const keepInView = (scroll: ScrollBoxRenderable, line: number): void => {
  const { height } = scroll.viewport;
  if (line <= scroll.scrollTop) {
    scroll.scrollTop = Math.max(line - 1, 0);
  } else if (height > 0 && line >= scroll.scrollTop + height) {
    scroll.scrollTop = line - height + 1;
  }
};

type Parts = ReturnType<typeof build>;

const scrollUnits = { line: "absolute", page: "viewport" } as const;

/** How wide the details pane is: its share of the width, but no less. */
const detailsWidthOf = (width: number): number =>
  Math.max(
    detailsLeast,
    Math.round((inner(width) - paneGap) / (tableShare + 1))
  );

/** Builds every renderable and adds them to the renderer. */
const build = (renderer: CliRenderer) => {
  renderer.setBackgroundColor(theme.background);
  const root = new BoxRenderable(renderer, {
    backgroundColor: theme.background,
    flexDirection: "column",
    flexGrow: 1,
    gap: 1,
    paddingX: rootPadding / 2,
    paddingY: 1,
  });
  const header = buildHeader(renderer);
  const entry = buildInput(renderer);
  const summary = text(renderer);
  summary.flexShrink = 0;
  const results = buildResults(renderer);
  const connection = buildConnection(renderer);
  const help = buildHelp(renderer);
  const footer = text(renderer);
  footer.flexShrink = 0;
  addAll(root, [
    header.row,
    entry.box,
    summary,
    results.row,
    connection.view,
    help.box,
    footer,
  ]);
  renderer.root.add(root);
  return { connection, entry, footer, header, help, results, root, summary };
};

/** Makes room on a short screen, so the keys at the bottom stay in view. */
const drawSpacing = (p: Parts, height: number) => {
  const short = height < shortHeight;
  p.root.gap = Number(!short);
  p.root.paddingY = Number(!short);
  p.header.row.visible = height >= tinyHeight;
};

const drawFrame = (p: Parts, s: State, { wide, width }: Layout) => {
  let suffix = `v${s.version}`;
  if (wide) {
    suffix = `network blocker checker · ${suffix}`;
  }
  if (s.screen === "connection") {
    suffix = "› your connection";
  }
  p.header.title.content = lines([
    [
      paint("nbchecker", { bold: true, fg: theme.accent }),
      paint(`  ${suffix}`, { fg: theme.dim }),
    ],
  ]);
  p.header.badge.content = connectionBadge(s);
  if (s.screen === "connection") {
    p.header.badge.content = lines([[paint("← esc back to results")]]);
  }
  const main = s.screen === "main";
  p.entry.box.visible = main;
  p.summary.visible = main;
  p.results.row.visible = main;
  p.results.details.visible = wide;
  p.connection.view.visible = s.screen === "connection";
  p.help.box.visible = s.screen === "help";
  p.footer.content = footerText(s, inner(width));
};

const drawMain = (
  p: Parts,
  s: State,
  items: readonly Filter[],
  { wide, width }: Layout
) => {
  p.entry.hint.content = inputHint(s);
  // The input is outlined in the accent colour except while a check runs.
  let inputColor: string = theme.accent;
  if (s.checking) {
    inputColor = theme.border;
  }
  p.entry.box.borderColor = inputColor;
  p.entry.box.titleColor = inputColor;
  p.summary.content = summaryText(s, wide);
  const detailsWidth = detailsWidthOf(width);
  p.results.details.width = detailsWidth;
  let tableWidth = inner(width) - paneChrome - scrollBar;
  if (wide) {
    tableWidth -= detailsWidth + paneGap;
  }
  let groups = idleGroups(items);
  if (s.result !== undefined) {
    groups = resultGroups(s.result);
  }
  const table = tableText(groups, s.selected, tableWidth, s.tick);
  p.results.head.content = tableHeader(tableWidth);
  p.results.table.content = table.text;
  keepInView(p.results.scroll, table.selectedLine);
  p.results.detailsBody.content = detailsText(
    flatRows(groups)[s.selected],
    s.result?.host ?? "",
    detailsWidth - paneChrome,
    s.tick
  );
};

export type ScrollUnit = "line" | "page";

export interface Screen {
  readonly draw: (s: State) => void;
  readonly input: InputRenderable;
  /** Scrolls the help or connection screen, whichever is showing. */
  readonly scroll: (delta: number, unit: ScrollUnit) => void;
}

/** Builds the screen on `renderer`. */
export const mountScreen = (
  renderer: CliRenderer,
  items: readonly Filter[]
): Screen => {
  const parts = build(renderer);
  const scrollers: Partial<Record<State["screen"], ScrollBoxRenderable>> = {
    connection: parts.connection.view,
    help: parts.help.scroll,
  };
  let shown: State["screen"] = "main";
  const draw = (s: State): void => {
    // A screen opens at its top.
    if (s.screen !== shown) {
      shown = s.screen;
      scrollers[shown]?.scrollTo(0);
    }
    const { height, width } = renderer;
    const wide = width >= detailsMinWidth;
    drawSpacing(parts, height);
    drawFrame(parts, s, { wide, width });
    drawMain(parts, s, items, { wide, width });
    drawConnection(parts.connection, s, items, { wide, width });
  };
  const scroll = (delta: number, unit: ScrollUnit): void => {
    scrollers[shown]?.scrollBy(delta, scrollUnits[unit]);
  };
  return { draw, input: parts.entry.input, scroll };
};
