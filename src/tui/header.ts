/** The header: nbchecker's name, and a badge with this computer's filter. */
import {
  BoxRenderable,
  type CliRenderer,
  type StyledText,
} from "@opentui/core";
import { lines, paint } from "./paint.ts";
import type { State } from "./state.ts";
import { connectionBadge } from "./summary.ts";
import { theme } from "./theme.ts";
import {
  addAll,
  bodyOf,
  type Layout,
  linePaneHeight,
  pane,
  text,
} from "./widgets.ts";

const buildHeader = (renderer: CliRenderer) => {
  const row = new BoxRenderable(renderer, {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    height: linePaneHeight,
    justifyContent: "space-between",
  });
  const title = text(renderer);
  title.flexShrink = 0;
  const badgeBox = pane(renderer, { flexGrow: 0 });
  // On a narrow screen the badge is cut, not the name.
  badgeBox.flexShrink = 1;
  badgeBox.overflow = "hidden";
  const badge = bodyOf(renderer, badgeBox);
  badge.wrapMode = "none";
  addAll(row, [title, badgeBox]);
  return { badge, row, title };
};

type HeaderParts = ReturnType<typeof buildHeader>;

/** The name, then the version, or which screen this is. */
const titleText = (s: State, wide: boolean): StyledText => {
  let suffix = `v${s.version}`;
  if (wide) {
    suffix = `network blocker checker · ${suffix}`;
  }
  if (s.screen === "connection") {
    suffix = "› your connection";
  }
  return lines([
    [
      paint("nbchecker", { bold: true, fg: theme.accent }),
      paint(`  ${suffix}`, { fg: theme.dim }),
    ],
  ]);
};

/**
 * This computer's filter, or the way back on the connection screen, which
 * shows the filter in full.
 */
const badgeText = (s: State): StyledText => {
  if (s.screen === "connection") {
    return lines([[paint("← esc back to results")]]);
  }
  return connectionBadge(s);
};

const drawHeader = (parts: HeaderParts, s: State, { wide }: Layout) => {
  parts.title.content = titleText(s, wide);
  parts.badge.content = badgeText(s);
};

export { buildHeader, drawHeader };
