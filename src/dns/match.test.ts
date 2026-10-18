import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { replyTo, response } from "../testing/response.ts";
import { mismatch } from "./match.ts";
import { encodeQuery, Rcode } from "./wire.ts";

const queryId = 4242;
const flagsByte = 2;
/** The opcode bits in the first flags byte; 0x10 is opcode 2 (STATUS). */
const opcodeStatus = 0x10;
const notMatching = "bad answer: question doesn't match";

const query = Effect.runSync(encodeQuery(queryId, "example.com", "AAAA"));

/** A copy of `bytes` with the first flags byte changed. */
const withFlags = (bytes: Uint8Array, change: (b: number) => number) => {
  const out = Uint8Array.from(bytes);
  out[flagsByte] = change(out[flagsByte] ?? 0);
  return out;
};

describe("mismatch", () => {
  test("accepts the answer to the query", () => {
    expect(mismatch(query, replyTo(query))).toBeUndefined();
  });

  test("ignores the case of the name", () => {
    const reply = replyTo(query, { question: "EXAMPLE.com" });
    expect(mismatch(query, reply)).toBeUndefined();
  });

  test("rejects a message that isn't a response", () => {
    expect(mismatch(query, query)).toBe("bad answer: not a response");
  });

  test("rejects another opcode", () => {
    const reply = withFlags(replyTo(query), (b) => b + opcodeStatus);
    expect(mismatch(query, reply)).toBe("bad answer: wrong opcode");
  });

  test("rejects another ID", () => {
    const reply = replyTo(query, { id: queryId + 1 });
    expect(mismatch(query, reply)).toBe("answer was for a different query");
  });

  test("rejects another name or type", () => {
    const otherName = replyTo(query, { question: "bad.example" });
    expect(mismatch(query, otherName)).toBe(notMatching);
    const otherType = replyTo(query, { questionType: "A" });
    expect(mismatch(query, otherType)).toBe(notMatching);
  });

  test("accepts an error without a question, but not an answer", () => {
    const strip = (bytes: Uint8Array) => {
      const out = Uint8Array.from(bytes);
      const questionCount = 5;
      out[questionCount] = 0;
      return out;
    };
    const refused = strip(response({ id: queryId, rcode: Rcode.refused }));
    expect(mismatch(query, refused)).toBeUndefined();
    const answer = strip(response({ id: queryId }));
    expect(mismatch(query, answer)).toBe(notMatching);
  });

  test("rejects a reply cut short", () => {
    const end = 14;
    expect(mismatch(query, replyTo(query).subarray(0, end))).toBe(
      "label runs past the end"
    );
  });
});
