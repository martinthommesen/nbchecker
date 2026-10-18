import { Data, Runtime } from "effect";

/**
 * Ends the program with an exit status. The runtime reads the status from
 * the error and, because `errorReported` is false, logs nothing: the result
 * has already been printed.
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
