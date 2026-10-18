/** Everything the interactive screen shows, in one value. */
import type { Connection } from "../check/connection.ts";
import type { CheckResult } from "../check/result.ts";

export type Screen = "connection" | "help" | "main";

export interface State {
  /** The last check was cancelled, so `result` is only part of an answer. */
  readonly cancelled: boolean;
  /** A check is running; `result` holds what has answered so far. */
  readonly checking: boolean;
  /** Undefined while it is still being detected. */
  readonly connection: Connection | undefined;
  /** How long the last check took. */
  readonly elapsedMs: number | undefined;
  readonly focus: "input" | "table";
  readonly result: CheckResult | undefined;
  readonly screen: Screen;
  /** The selected row, counted across all groups. */
  readonly selected: number;
  /** Counts spinner frames. */
  readonly tick: number;
  /** A short message in the footer, such as "copied". */
  readonly toast: string | undefined;
  readonly version: string;
}

export const initialState = (version: string): State => ({
  cancelled: false,
  checking: false,
  connection: undefined,
  elapsedMs: undefined,
  focus: "input",
  result: undefined,
  screen: "main",
  selected: 0,
  tick: 0,
  toast: undefined,
  version,
});
