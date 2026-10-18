/** The renderables of the interactive screen, redrawn from the state. */
import {
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import type { Filter } from "../check/filters.ts";
import { buildConnection, drawConnection } from "./connection-screen.ts";
import { helpText } from "./help.ts";
import { footerText } from "./keys.ts";
import { lines, paint } from "./paint.ts";
import {
  addAll,
  inner,
  type Layout,
  pane,
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

/** Below this width the details pane is left out. */
const detailsMinWidth = 100;
const detailsLeast = 36;
/** The table gets twice the width of the details pane. */
const tableShare = 2;
/** Room for the table's scroll bar. */
const scrollBar = 2;
const boxHeight = 3;

const buildHeader = (renderer: CliRenderer) => {
  const row = new BoxRenderable(renderer, {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    height: boxHeight,
    justifyContent: "space-between",
  });
  const title = text(renderer);
  const badgeBox = pane(renderer, { flexGrow: 0 });
  const badge = text(renderer);
  badgeBox.add(badge);
  addAll(row, [title, badgeBox]);
  return { badge, row, title };
};

const buildInput = (renderer: CliRenderer) => {
  const box = pane(renderer, {
    color: theme.accent,
    flexGrow: 0,
    title: "Domain or IP",
  });
  box.flexDirection = "row";
  box.height = boxHeight;
  box.flexShrink = 0;
  const prompt = new TextRenderable(renderer, {
    content: lines([[paint("› ", { fg: theme.accent })]]),
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
  const hint = text(renderer);
  addAll(box, [prompt, input, hint]);
  return { box, hint, input };
};

const buildResults = (renderer: CliRenderer) => {
  const row = new BoxRenderable(renderer, {
    columnGap: paneGap,
    flexDirection: "row",
    flexGrow: 1,
  });
  const resolvers = pane(renderer, { title: "Resolvers" });
  resolvers.flexShrink = 1;
  const head = text(renderer);
  const scroll = new ScrollBoxRenderable(renderer, { flexGrow: 1 });
  const table = text(renderer);
  scroll.add(table);
  addAll(resolvers, [head, scroll]);
  const details = pane(renderer, { flexGrow: 0, title: "Details" });
  const detailsBody = text(renderer);
  details.add(detailsBody);
  addAll(row, [resolvers, details]);
  return { details, detailsBody, head, row, scroll, table };
};

const buildHelp = (renderer: CliRenderer) => {
  const help = pane(renderer, { title: "Help" });
  help.visible = false;
  const helpScroll = new ScrollBoxRenderable(renderer, { flexGrow: 1 });
  const helpBody = text(renderer);
  helpScroll.add(helpBody);
  help.add(helpScroll);
  helpBody.content = helpText();
  return help;
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

type Parts = ReturnType<typeof build>;

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
    help,
    footer,
  ]);
  renderer.root.add(root);
  return { connection, entry, footer, header, help, results, summary };
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
  p.connection.view.flexDirection = "column";
  if (wide) {
    p.connection.view.flexDirection = "row";
  }
  p.help.visible = s.screen === "help";
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

export interface Screen {
  readonly draw: (s: State) => void;
  readonly input: InputRenderable;
}

/** Builds the screen on `renderer`. */
export const mountScreen = (
  renderer: CliRenderer,
  items: readonly Filter[]
): Screen => {
  const parts = build(renderer);
  const draw = (s: State): void => {
    const { width } = renderer;
    const wide = width >= detailsMinWidth;
    drawFrame(parts, s, { wide, width });
    drawMain(parts, s, items, { wide, width });
    drawConnection(parts.connection, s, items, { wide, width });
  };
  return { draw, input: parts.entry.input };
};
