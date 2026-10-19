import { describe, expect, test } from "bun:test";
import { frame, unframe } from "./bytes.ts";

// The loopback test servers frame with these same functions, so these fixed
// bytes are what pin the DNS over TCP length prefix.
const message = new TextEncoder().encode("dns");
/** The message after its length: a big-endian uint16 of the message alone. */
const framed = Uint8Array.of(0, message.length, ...message);

describe("frame", () => {
  test("puts the message's length before it, high byte first", () => {
    expect(frame(message)).toEqual(framed);
  });
});

describe("unframe", () => {
  test("returns the message once all of it has arrived", () => {
    expect(unframe(framed)).toEqual(message);
  });

  test("waits for the rest of the length or the message", () => {
    expect(unframe(framed.subarray(0, 1))).toBeUndefined();
    expect(unframe(framed.subarray(0, -1))).toBeUndefined();
  });

  test("returns only the first message when more bytes follow", () => {
    expect(unframe(Uint8Array.of(...framed, ...framed))).toEqual(message);
  });
});
