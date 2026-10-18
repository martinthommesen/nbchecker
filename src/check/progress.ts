/** Lets the interactive screen show answers as they arrive. */
import { Context, Effect } from "effect";
import type { CheckResult } from "./result.ts";

/**
 * Called with the result so far each time a resolver answers, and once
 * before any has. Does nothing unless replaced.
 */
export const Progress = Context.Reference<
  (sofar: CheckResult) => Effect.Effect<void>
>("nbchecker/Progress", { defaultValue: () => () => Effect.void });
