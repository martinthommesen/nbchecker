/** Which key does what on each screen. */
import type { State } from "./state.ts";

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

export { actionFor };
