/**
 * The interactive screen: its parts stacked between the header and the keys,
 * built once and redrawn from the state.
 */
import {
  BoxRenderable,
  type CliRenderer,
  type InputRenderable,
  type Renderable,
  type ScrollBoxRenderable,
} from "@opentui/core";
import type { Filter } from "../check/filters.ts";
import { buildConnection, drawConnection } from "./connection-screen.ts";
import { footerText } from "./footer.ts";
import { buildHeader, drawHeader } from "./header.ts";
import { buildHelp } from "./help.ts";
import { buildMain, drawMain } from "./main-screen.ts";
import type { Screen, State } from "./state.ts";
import { theme } from "./theme.ts";
import { addAll, inner, type Layout, rootPadding, text } from "./widgets.ts";

/** Below this height the screen drops its spacing, and then its header. */
const shortHeight = 20;
const tinyHeight = 16;
/** Below this width the details pane is left out. */
const detailsMinWidth = 100;

const scrollUnits = { line: "absolute", page: "viewport" } as const;

/** Builds every part and adds them to the renderer. */
const build = (renderer: CliRenderer, items: readonly Filter[]) => {
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
  const main = buildMain(renderer, items);
  const connection = buildConnection(renderer, items);
  const help = buildHelp(renderer);
  const footer = text(renderer);
  footer.flexShrink = 0;
  /** What each screen shows between the header and the keys. */
  const screens: Record<Screen, readonly Renderable[]> = {
    connection: [connection.view],
    help: [help.box],
    main: [main.entry.box, main.summary, main.results.row],
  };
  addAll(root, [
    header.row,
    ...screens.main,
    ...screens.connection,
    ...screens.help,
    footer,
  ]);
  renderer.root.add(root);
  return { connection, footer, header, help, main, root, screens };
};

type Parts = ReturnType<typeof build>;

/** Makes room on a short screen, so the keys at the bottom stay in view. */
const drawSpacing = (p: Parts, height: number) => {
  const short = height < shortHeight;
  p.root.gap = Number(!short);
  p.root.paddingY = Number(!short);
  p.header.row.visible = height >= tinyHeight;
};

/** Shows the parts of the screen the state is on, and hides the others. */
const showScreen = (p: Parts, screen: Screen) => {
  for (const [name, boxes] of Object.entries(p.screens)) {
    for (const box of boxes) {
      box.visible = name === screen;
    }
  }
};

export type ScrollUnit = "line" | "page";

/** The screen once built: what the controller and the key handlers use. */
export interface MountedScreen {
  readonly draw: (s: State) => void;
  readonly input: InputRenderable;
  /** Scrolls the help or connection screen, whichever is showing. */
  readonly scroll: (delta: number, unit: ScrollUnit) => void;
}

/** Builds the screen on `renderer`, listing `items` until a check is done. */
export const mountScreen = (
  renderer: CliRenderer,
  items: readonly Filter[]
): MountedScreen => {
  const parts = build(renderer, items);
  const scrollers: Partial<Record<Screen, ScrollBoxRenderable>> = {
    connection: parts.connection.view,
    help: parts.help.scroll,
  };
  let shown: Screen = "main";
  const draw = (s: State): void => {
    // A screen opens at its top.
    if (s.screen !== shown) {
      shown = s.screen;
      scrollers[shown]?.scrollTo(0);
    }
    const { height, width } = renderer;
    const layout: Layout = { wide: width >= detailsMinWidth, width };
    drawSpacing(parts, height);
    drawHeader(parts.header, s, layout);
    showScreen(parts, s.screen);
    parts.footer.content = footerText(s, inner(width));
    drawMain(parts.main, s, layout);
    drawConnection(parts.connection, s, layout);
  };
  const scroll = (delta: number, unit: ScrollUnit): void => {
    scrollers[shown]?.scrollBy(delta, scrollUnits[unit]);
  };
  return { draw, input: parts.main.entry.input, scroll };
};
