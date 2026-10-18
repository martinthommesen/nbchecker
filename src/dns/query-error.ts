import { Data } from "effect";

/** A DNS server or DNS-over-HTTPS endpoint gave no usable answer. */
export class QueryError extends Data.TaggedError("QueryError")<{
  readonly reason: string;
  readonly server: string;
}> {
  override get message(): string {
    return `${this.server}: ${this.reason}`;
  }
}
