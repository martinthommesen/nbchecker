/** The "your connection" screen's panes. */
import { BoxRenderable, type CliRenderer } from "@opentui/core";
import type { Filter } from "../check/filters.ts";
import {
  browserText,
  detectedText,
  filtersText,
  howText,
  safeZoneText,
} from "./connection-text.ts";
import type { State } from "./state.ts";
import { theme } from "./theme.ts";
import {
  addAll,
  bodyOf,
  column,
  inner,
  type Layout,
  pane,
  paneChrome,
  paneGap,
  scrollBox,
} from "./widgets.ts";

/** The two columns share the width equally. */
const detectionShare = 1;

/** `items` are the filters listed, with how each answered the self-test. */
const buildConnection = (renderer: CliRenderer, items: readonly Filter[]) => {
  // Scrolls, as a short screen can't show every pane at once.
  const view = scrollBox(renderer);
  view.visible = false;
  // At least as tall as the screen, so the panes reach down to the keys.
  view.content.minHeight = "100%";
  const panes = new BoxRenderable(renderer, {
    columnGap: paneGap,
    flexDirection: "row",
    flexGrow: 1,
    rowGap: 1,
  });
  const left = column(renderer, detectionShare);
  const detected = pane(renderer, {
    color: theme.accent,
    flexGrow: 0,
    title: "Detected filter",
  });
  detected.borderColor = theme.accent;
  const how = pane(renderer, { title: "How we know" });
  addAll(left, [detected, how]);
  const right = column(renderer, 1);
  const filters = pane(renderer, { flexGrow: 0, title: "Filters we look for" });
  const safeZone = pane(renderer, {
    color: theme.warn,
    flexGrow: 0,
    title: "About SafeZone",
  });
  const browser = pane(renderer, {
    color: theme.warn,
    flexGrow: 0,
    title: "Your browser may differ",
  });
  addAll(right, [filters, safeZone, browser]);
  addAll(panes, [left, right]);
  view.add(panes);
  const bodies = {
    browser: bodyOf(renderer, browser),
    detected: bodyOf(renderer, detected),
    filters: bodyOf(renderer, filters),
    how: bodyOf(renderer, how),
    safeZone: bodyOf(renderer, safeZone),
  };
  bodies.safeZone.content = safeZoneText();
  bodies.browser.content = browserText();
  return { bodies, columns: [left, right], items, panes, view };
};

type ConnectionParts = ReturnType<typeof buildConnection>;

/** The width inside the "How we know" pane, a column's width when wide. */
const howWidthOf = ({ wide, width }: Layout): number => {
  if (wide) {
    return Math.floor(
      ((inner(width) - paneGap) * detectionShare) / (detectionShare + 1) -
        paneChrome
    );
  }
  return inner(width) - paneChrome;
};

const drawConnection = (parts: ConnectionParts, s: State, layout: Layout) => {
  // Side by side the columns share the width; stacked, each is its own height.
  parts.panes.flexDirection = "column";
  let basis: number | "auto" = "auto";
  if (layout.wide) {
    parts.panes.flexDirection = "row";
    basis = 0;
  }
  for (const c of parts.columns) {
    c.flexBasis = basis;
  }
  const { bodies } = parts;
  const c = s.network?.connection;
  bodies.detected.content = detectedText(c, s.tick);
  bodies.how.content = howText(c, howWidthOf(layout));
  bodies.filters.content = filtersText(s.network, parts.items);
};

export { buildConnection, drawConnection };
