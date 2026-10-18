/** Everything the interactive screen shows, in one value. */
import type { CheckResult, Network } from "../check/result.ts";

export type Screen = "connection" | "help" | "main";

export interface State {
  /** A check is running; `result` holds what has answered so far. */
  readonly checking: boolean;
  /** How long the last check took. */
  readonly elapsedMs: number | undefined;
  readonly focus: "input" | "table";
  /**
   * The connection and the self-test; undefined while they are still being
   * detected.
   */
  readonly network: Network | undefined;
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
  checking: false,
  elapsedMs: undefined,
  focus: "input",
  network: undefined,
  result: undefined,
  screen: "main",
  selected: 0,
  tick: 0,
  toast: undefined,
  version,
});
