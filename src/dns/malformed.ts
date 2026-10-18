import { Data } from "effect";

/** A DNS message that could not be encoded or decoded. */
export class MalformedMessage extends Data.TaggedError("MalformedMessage")<{
  readonly reason: string;
}> {}
