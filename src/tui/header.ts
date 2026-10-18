/** The header: nbchecker's name, and a badge with this computer's filter. */
import {
  BoxRenderable,
  type CliRenderer,
  type StyledText,
  type TextChunk,
} from "@opentui/core";
import { seemsIntercepted } from "../check/evidence.ts";
import { detecting } from "./connection-text.ts";
import { lines, oneLine, paint } from "./paint.ts";
import type { State } from "./state.ts";
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

/** Which filter this computer's DNS uses, in a word or two. */
const connectionStatus = (s: State): TextChunk => {
  const c = s.network?.connection;
  if (c === undefined) {
    return detecting(s.tick);
  }
  if (seemsIntercepted(s.network)) {
    return paint("? DNS intercepted", { fg: theme.warn });
  }
  if (c.filter !== undefined) {
    return paint(`✕ ${c.filter}`, { fg: theme.block });
  }
  if (c.error !== undefined) {
    return paint("? unknown", { fg: theme.warn });
  }
  return paint("· no filter detected", { fg: theme.dim });
};

/**
 * This computer's filter, or the way back on the connection screen, which
 * shows the filter in full.
 */
const badgeText = (s: State): StyledText => {
  if (s.screen === "connection") {
    return oneLine("← esc back to results");
  }
  return lines([
    [paint("your connection  ", { fg: theme.dim }), connectionStatus(s)],
  ]);
};

const drawHeader = (parts: HeaderParts, s: State, { wide }: Layout) => {
  parts.title.content = titleText(s, wide);
  parts.badge.content = badgeText(s);
};

export { buildHeader, drawHeader };
