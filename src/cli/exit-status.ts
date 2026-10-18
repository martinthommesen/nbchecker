/** Every exit status nbchecker ends with, so scripts can act on the result. */
import { Console, Data, Effect, Runtime } from "effect";
import { type CheckResult, isBlocked } from "../check/result.ts";

/** Nothing was blocked, and every check was complete. */
export const exitNotBlocked = 0;

/** Something was blocked, even if some filters didn't answer. */
export const exitBlocked = 1;

/** A check was incomplete, so nbchecker couldn't tell. */
export const exitIncomplete = 2;

/** EX_USAGE from sysexits.h: nbchecker was run with a mistyped flag or nothing to check. */
export const exitUsage = 64;

/** EX_IOERR from sysexits.h: the results couldn't be written. */
export const exitOutput = 74;

/**
 * Ends the program with an exit status. The runtime reads the status from
 * the error and, because `errorReported` is false, logs nothing: whatever
 * needs saying has already been printed.
 */
export class ExitStatus extends Data.TaggedError("ExitStatus")<{
  readonly code: number;
}> {
  override get [Runtime.errorExitCode](): number {
    return this.code;
  }

  override get [Runtime.errorReported](): boolean {
    return false;
  }
}

/**
 * Blocked if anything is blocked, even when a check was incomplete;
 * otherwise incomplete if a check was, so that nbchecker couldn't tell;
 * otherwise not blocked. See `completionOf` for what makes a check
 * incomplete.
 */
export const exitCode = (results: readonly CheckResult[]): number => {
  if (results.some(isBlocked)) {
    return exitBlocked;
  }
  if (results.some((r) => r.completion !== "complete")) {
    return exitIncomplete;
  }
  return exitNotBlocked;
};

/** Says on standard error why nbchecker stops, then ends it with `code`. */
export const stop = (code: number, why: string) =>
  Console.error(`nbchecker: ${why}`).pipe(
    Effect.andThen(Effect.fail(new ExitStatus({ code })))
  );
