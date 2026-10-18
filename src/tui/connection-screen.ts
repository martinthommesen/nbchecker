/** The "your connection" screen's panes. */
import { BoxRenderable, type CliRenderer } from "@opentui/core";
import type { Filter } from "../check/filters.ts";
import {
  browserText,
  detectedText,
  filtersText,
  howText,
  safeZoneText,
} from "./connection-view.ts";
import {
  addAll,
  bodyOf,
  column,
  inner,
  type Layout,
  pane,
  paneChrome,
  paneGap,
} from "./panes.ts";
import type { State } from "./state.ts";
import { theme } from "./theme.ts";

/** The two columns share the width equally. */
const detectionShare = 1;

const buildConnection = (renderer: CliRenderer) => {
  const view = new BoxRenderable(renderer, {
    columnGap: paneGap,
    flexDirection: "row",
    flexGrow: 1,
    rowGap: 1,
    visible: false,
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
  // On a short screen the notes at the bottom are cut, not drawn over the keys.
  right.overflow = "hidden";
  left.overflow = "hidden";
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
  addAll(view, [left, right]);
  const bodies = {
    browser: bodyOf(renderer, browser),
    detected: bodyOf(renderer, detected),
    filters: bodyOf(renderer, filters),
    how: bodyOf(renderer, how),
    safeZone: bodyOf(renderer, safeZone),
  };
  bodies.safeZone.content = safeZoneText();
  bodies.browser.content = browserText();
  return { bodies, view };
};

type ConnectionParts = ReturnType<typeof buildConnection>;

const drawConnection = (
  parts: ConnectionParts,
  s: State,
  items: readonly Filter[],
  { wide, width }: Layout
) => {
  let howWidth = inner(width) - paneChrome;
  if (wide) {
    howWidth = Math.floor(
      ((inner(width) - paneGap) * detectionShare) / (detectionShare + 1) -
        paneChrome
    );
  }
  const { bodies } = parts;
  const c = s.network?.connection;
  bodies.detected.content = detectedText(c, s.tick);
  bodies.how.content = howText(c, howWidth);
  bodies.filters.content = filtersText(s.network, items);
};

export { buildConnection, drawConnection };
