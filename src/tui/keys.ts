/** Which key does what on each screen, and the footer that lists them. */
import type { StyledText, TextChunk } from "@opentui/core";
import { lines, paint } from "./paint.ts";
import type { State } from "./state.ts";
import { columns } from "./text-layout.ts";
import { theme } from "./theme.ts";

const tableKeys = new Map<string, Action>([
  ["/", "newCheck"],
  ["?", "help"],
  ["c", "connection"],
  ["down", "down"],
  ["e", "export"],
  ["escape", "cancel"],
  ["j", "down"],
  ["k", "up"],
  ["pagedown", "pageDown"],
  ["pageup", "pageUp"],
  ["q", "quit"],
  ["r", "recheck"],
  ["up", "up"],
  ["y", "copy"],
]);

const inputKeys = new Map<string, Action>([
  ["down", "historyDown"],
  ["escape", "leaveInput"],
  ["up", "historyUp"],
]);

/** The help and connection screens scroll, as they may not fit. */
const scrollKeys: readonly (readonly [string, Action])[] = [
  ["down", "scrollDown"],
  ["j", "scrollDown"],
  ["k", "scrollUp"],
  ["pagedown", "scrollPageDown"],
  ["pageup", "scrollPageUp"],
  ["up", "scrollUp"],
];

const connectionKeys = new Map<string, Action>([
  ...scrollKeys,
  ["?", "help"],
  ["escape", "back"],
  ["q", "quit"],
  ["r", "detect"],
  ["y", "copy"],
]);

const helpKeys = new Map<string, Action>([
  ...scrollKeys,
  ["?", "back"],
  ["escape", "back"],
  ["q", "quit"],
]);

const keyMaps = {
  connection: connectionKeys,
  help: helpKeys,
  main: tableKeys,
} as const;

/** What a key press does in state `s`, if anything. */
const actionFor = (s: State, key: Key): Action | undefined => {
  if (key.ctrl && key.name === "c") {
    return "quit";
  }
  let keys: ReadonlyMap<string, Action> = keyMaps[s.screen];
  if (s.screen === "main" && s.focus === "input") {
    keys = inputKeys;
  }
  return keys.get(key.name) ?? keys.get(key.sequence);
};

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
const footerText = (s: State, width: number): StyledText => {
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

export type Action =
  | "back"
  | "cancel"
  | "connection"
  | "copy"
  | "detect"
  | "down"
  | "export"
  | "help"
  | "historyDown"
  | "historyUp"
  | "leaveInput"
  | "newCheck"
  | "pageDown"
  | "pageUp"
  | "quit"
  | "recheck"
  | "scrollDown"
  | "scrollPageDown"
  | "scrollPageUp"
  | "scrollUp"
  | "up";

/** The parts of a key press that decide its action. */
export interface Key {
  readonly ctrl: boolean;
  readonly name: string;
  readonly sequence: string;
}

export { actionFor, footerText };
