import { Data, type Duration, Effect } from "effect";

/** A DNS server or DNS-over-HTTPS endpoint gave no usable answer. */
export class QueryError extends Data.TaggedError("QueryError")<{
  readonly reason: string;
  readonly server: string;
}> {
  override get message(): string {
    return `${this.server}: ${this.reason}`;
  }
}

/**
 * Gives up on `server` once `duration` has passed, so a resolver that never
 * answers can't hold up a check.
 */
export const timeoutAfter = (duration: Duration.Input, server: string) =>
  Effect.timeoutOrElse({
    duration,
    orElse: () =>
      Effect.fail(new QueryError({ reason: "no answer (timed out)", server })),
  });
