/** The footer: the keys the screen takes, and any short message after them. */
import type { StyledText, TextChunk } from "@opentui/core";
import { lines, paint } from "./paint.ts";
import type { State } from "./state.ts";
import { columns } from "./text-layout.ts";
import { theme } from "./theme.ts";

const footers = {
  checking: [
    ["esc", "cancel"],
    ["?", "help"],
    ["q", "quit"],
  ],
  connection: [
    ["↑↓", "scroll"],
    ["pgup pgdn", "page"],
    ["esc", "back"],
    ["r", "detect again"],
    ["y", "copy as text"],
    ["?", "help"],
    ["q", "quit"],
  ],
  help: [
    ["↑↓", "scroll"],
    ["pgup pgdn", "page"],
    ["esc", "back"],
    ["q", "quit"],
  ],
  results: [
    ["↑↓", "select"],
    ["/", "new check"],
    ["r", "recheck"],
    ["c", "your connection"],
    ["y", "copy as text"],
    ["e", "export JSON"],
    ["?", "help"],
    ["q", "quit"],
  ],
  starting: [
    ["enter", "check"],
    ["ctrl+c", "quit"],
  ],
  typing: [
    ["enter", "check"],
    ["↑↓", "earlier checks"],
    ["esc", "back"],
    ["ctrl+c", "quit"],
  ],
} as const;

const footerKeys = (s: State) => {
  if (s.screen !== "main") {
    return footers[s.screen];
  }
  if (s.focus === "input" && s.result === undefined && !s.checking) {
    return footers.starting;
  }
  if (s.focus === "input") {
    return footers.typing;
  }
  if (s.checking) {
    return footers.checking;
  }
  return footers.results;
};

const gap = "  ";

/**
 * The key list at the bottom, with any short message after it, wrapped
 * between keys so a key stays with its label. A message too long for the
 * line wraps on its own.
 */
export const footerText = (s: State, width: number): StyledText => {
  const items = footerKeys(s).map(([key, label]) => ({ key, label }));
  const rows: TextChunk[][] = [[]];
  let used = 0;
  for (const { key, label } of items) {
    const size = columns(` ${key}  ${label}${gap}`);
    if (used > 0 && used + size > width) {
      rows.push([]);
      used = 0;
    }
    rows
      .at(-1)
      ?.push(
        paint(` ${key} `, { bg: theme.chip }),
        paint(` ${label}${gap}`, { fg: theme.dim })
      );
    used += size;
  }
  // A message that doesn't fit after the keys gets a line of its own.
  if (s.toast !== undefined) {
    if (used + columns(s.toast) > width) {
      rows.push([]);
    }
    rows.at(-1)?.push(paint(s.toast, { fg: theme.warn }));
  }
  return lines(rows);
};
