import { describe, expect, test } from "bun:test";
import { hex, query, queryId, replyTo, response } from "../testing/response.ts";
import { Rcode } from "./codes.ts";
import { mismatch } from "./match.ts";

const flagsByte = 2;
/** The opcode bits in the first flags byte; 0x10 is opcode 2 (STATUS). */
const opcodeStatus = 0x10;
const notMatching = "bad answer: question doesn't match";

/** A copy of `bytes` with the first flags byte changed. */
const withFlags = (bytes: Uint8Array, change: (b: number) => number) => {
  const out = Uint8Array.from(bytes);
  out[flagsByte] = change(out[flagsByte] ?? 0);
  return out;
};

/** A copy of `bytes` that says it has no question. */
const strip = (bytes: Uint8Array) => {
  const out = Uint8Array.from(bytes);
  const questionCount = 5;
  out[questionCount] = 0;
  return out;
};

describe("mismatch", () => {
  test("accepts the answer to the query", () => {
    expect(mismatch(query, replyTo(query))).toBeUndefined();
  });

  test("accepts an answer written byte by byte, not by the test encoder", () => {
    // ID 7 (the query's), QR and RD set, one question and one answer:
    // example.com A 192.0.2.1.
    const reply = hex(`
      00 07 81 00 00 01 00 01 00 00 00 00
      07 65 78 61 6d 70 6c 65 03 63 6f 6d 00 00 01 00 01
      c0 0c 00 01 00 01 00 00 00 3c 00 04 c0 00 02 01
    `);
    expect(mismatch(query, reply)).toBeUndefined();
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
    const otherType = replyTo(query, { questionType: "AAAA" });
    expect(mismatch(query, otherType)).toBe(notMatching);
  });

  test("accepts an error without a question, but not an answer", () => {
    const refused = strip(response({ id: queryId, rcode: Rcode.refused }));
    expect(mismatch(query, refused)).toBeUndefined();
    const answer = strip(response({ id: queryId }));
    expect(mismatch(query, answer)).toBe(notMatching);
  });

  test("rejects an error reply cut short inside its header", () => {
    const refused = response({ id: queryId, rcode: Rcode.refused });
    const questionless = 6;
    expect(mismatch(query, strip(refused).subarray(0, questionless))).toBe(
      "bad answer: header cut short"
    );
  });

  test("rejects a reply cut short", () => {
    const end = 14;
    expect(mismatch(query, replyTo(query).subarray(0, end))).toBe(
      "label runs past the end"
    );
  });
});
