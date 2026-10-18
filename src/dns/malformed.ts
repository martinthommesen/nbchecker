import { Data } from "effect";

/** A DNS message that could not be encoded or decoded. */
export class MalformedResponse extends Data.TaggedError("MalformedResponse")<{
  readonly reason: string;
}> {}
