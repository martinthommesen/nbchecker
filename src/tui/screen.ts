/** The renderables of the interactive screen, redrawn from the state. */
import {
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import type { Filter } from "../check/filters.ts";
import { detectionText, filtersText } from "./connection-view.ts";
import { helpText } from "./help.ts";
import { footerText } from "./keys.ts";
import { lines, paint } from "./paint.ts";
import { flatRows, idleGroups, resultGroups } from "./rows.ts";
import type { State } from "./state.ts";
import { connectionBadge, inputHint, summaryText } from "./summary.ts";
import { detailsText, tableHeader, tableText } from "./table.ts";
import { theme } from "./theme.ts";

/** Below this width the details pane is left out. */
const detailsMinWidth = 100;
const detailsWidth = 42;
/** Border and padding on each side of a pane. */
const paneChrome = 4;
/** Room for the table's scroll bar. */
const scrollBar = 1;
const rootPadding = 2;
const boxHeight = 3;

const pane = (renderer: CliRenderer, title: string, flexGrow = 1) =>
  new BoxRenderable(renderer, {
    border: true,
    borderColor: theme.border,
    borderStyle: "rounded",
    flexDirection: "column",
    flexGrow,
    paddingX: 1,
    title: ` ${title} `,
  });

const text = (renderer: CliRenderer) =>
  new TextRenderable(renderer, { content: lines([]), wrapMode: "word" });

const addAll = (
  parent: BoxRenderable | ScrollBoxRenderable,
  children: readonly (
    | BoxRenderable
    | InputRenderable
    | ScrollBoxRenderable
    | TextRenderable
  )[]
) => {
  for (const child of children) {
    parent.add(child);
  }
};

const buildHeader = (renderer: CliRenderer) => {
  const row = new BoxRenderable(renderer, {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    height: boxHeight,
    justifyContent: "space-between",
  });
  const title = text(renderer);
  const badgeBox = pane(renderer, "your connection", 0);
  const badge = text(renderer);
  badgeBox.add(badge);
  addAll(row, [title, badgeBox]);
  return { badge, row, title };
};

const buildInput = (renderer: CliRenderer) => {
  const box = pane(renderer, "Domain or IP", 0);
  box.flexDirection = "row";
  box.height = boxHeight;
  box.flexShrink = 0;
  const prompt = new TextRenderable(renderer, {
    content: lines([[paint("› ", { fg: theme.accent })]]),
  });
  const input = new InputRenderable(renderer, {
    flexGrow: 1,
    placeholder: "example.com",
  });
  const hint = text(renderer);
  addAll(box, [prompt, input, hint]);
  return { box, hint, input };
};

const buildResults = (renderer: CliRenderer) => {
  const row = new BoxRenderable(renderer, {
    flexDirection: "row",
    flexGrow: 1,
  });
  const resolvers = pane(renderer, "Resolvers");
  const head = text(renderer);
  const scroll = new ScrollBoxRenderable(renderer, { flexGrow: 1 });
  const table = text(renderer);
  scroll.add(table);
  addAll(resolvers, [head, scroll]);
  const details = pane(renderer, "Details", 0);
  details.width = detailsWidth;
  const detailsBody = text(renderer);
  details.add(detailsBody);
  addAll(row, [resolvers, details]);
  return { details, detailsBody, head, row, scroll, table };
};

const buildOther = (renderer: CliRenderer) => {
  const connection = new BoxRenderable(renderer, {
    flexDirection: "row",
    flexGrow: 1,
    visible: false,
  });
  const detection = pane(renderer, "Your connection");
  const detectionBody = text(renderer);
  detection.add(detectionBody);
  const filters = pane(renderer, "Filters");
  const filtersBody = text(renderer);
  filters.add(filtersBody);
  addAll(connection, [detection, filters]);
  const help = pane(renderer, "Help");
  help.visible = false;
  const helpScroll = new ScrollBoxRenderable(renderer, { flexGrow: 1 });
  const helpBody = text(renderer);
  helpScroll.add(helpBody);
  help.add(helpScroll);
  return { connection, detectionBody, filters, filtersBody, help, helpBody };
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

interface Layout {
  readonly wide: boolean;
  readonly width: number;
}

/** Builds every renderable and adds them to the renderer. */
const build = (renderer: CliRenderer) => {
  const root = new BoxRenderable(renderer, {
    flexDirection: "column",
    flexGrow: 1,
    paddingX: 1,
  });
  const header = buildHeader(renderer);
  const entry = buildInput(renderer);
  const summary = text(renderer);
  summary.flexShrink = 0;
  const results = buildResults(renderer);
  const other = buildOther(renderer);
  const footer = text(renderer);
  footer.flexShrink = 0;
  addAll(root, [
    header.row,
    entry.box,
    summary,
    results.row,
    other.connection,
    other.help,
    footer,
  ]);
  renderer.root.add(root);
  other.helpBody.content = helpText();
  return { entry, footer, header, other, results, summary };
};

const drawFrame = (p: Parts, s: State, { wide, width }: Layout) => {
  let suffix = `network blocker checker · v${s.version}`;
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
  const main = s.screen === "main";
  p.entry.box.visible = main;
  p.summary.visible = main;
  p.results.row.visible = main;
  p.results.details.visible = wide;
  p.other.connection.visible = s.screen === "connection";
  p.other.connection.flexDirection = "column";
  if (wide) {
    p.other.connection.flexDirection = "row";
  }
  p.other.help.visible = s.screen === "help";
  p.footer.content = footerText(s, width - rootPadding);
};

const drawMain = (
  p: Parts,
  s: State,
  items: readonly Filter[],
  { wide, width }: Layout
) => {
  p.entry.hint.content = inputHint(s);
  p.summary.content = summaryText(s, wide);
  let tableWidth = width - rootPadding - paneChrome - scrollBar;
  if (wide) {
    tableWidth -= detailsWidth;
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
    parts.other.detectionBody.content = detectionText(s.connection, s.tick);
    parts.other.filtersBody.content = filtersText(s.connection, items);
  };
  return { draw, input: parts.entry.input };
};
