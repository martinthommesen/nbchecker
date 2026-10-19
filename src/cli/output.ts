/** Standard output for results, written in full before nbchecker exits. */
import { type FileSink, stdout } from "bun";
import { Effect } from "effect";
import { exitOutput, stop } from "./exit-status.ts";

let out: FileSink | undefined;

/** A reader that has gone away, such as `head`, isn't worth reporting. */
const readerGone = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "EPIPE";

/**
 * Writes a line and waits until it has been written. The runtime exits
 * straight away on a nonzero status, and Console.log (or Bun.write) can
 * still be holding output for a slow reader at the other end of a pipe,
 * which then got a cut-off or garbled copy.
 */
const writeLine = (text: string) =>
  Effect.tryPromise({
    catch: (error) => error,
    try: async () => {
      out ??= stdout.writer();
      out.write(`${text}\n`);
      await out.flush();
    },
  });

/**
 * Ignores a reader that has gone away. Any other write failure, such as a
 * full disk, ends the run with its own status, so a script doesn't take
 * missing results for a clean check.
 */
const onWriteError = (error: unknown) => {
  if (readerGone(error)) {
    return Effect.void;
  }
  return stop(exitOutput, `couldn't write the results: ${error}`);
};

/** Prints a line of results before going on, so none are lost at exit. */
export const print = (text: string) =>
  writeLine(text).pipe(Effect.catch(onWriteError));
