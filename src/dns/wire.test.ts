import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { response } from "../testing/response.ts";
import { decodeResponse, encodeQuery, Rcode, responseId } from "./wire.ts";

const decode = (bytes: Uint8Array) => Effect.runSync(decodeResponse(bytes));
const decodeError = (bytes: Uint8Array) =>
  Effect.runSync(Effect.flip(decodeResponse(bytes)));

const hexRadix = 16;
const whitespace = /\s+/;
const longestLabel = 63;

/** Turns "0a 0b ..." into bytes, so test messages read like a hex dump. */
const hex = (s: string): Uint8Array =>
  Uint8Array.from(s.split(whitespace).filter(Boolean), (b) =>
    Number.parseInt(b, hexRadix)
  );

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(hexRadix).padStart(2, "0")).join(" ");

const queryId = 4242;
const edeFiltered = 17;
// BADCOOKIE (23) is carried partly in the OPT record's extended rcode.
const extendedRcode = 23;

describe("encodeQuery", () => {
  test("writes the header, question and an EDNS OPT record", () => {
    const q = Effect.runSync(encodeQuery(queryId, "vg.no", "AAAA"));
    expect(responseId(q)).toBe(queryId);
    expect(toHex(q)).toBe(
      [
        "10 92 01 00 00 01 00 00 00 00 00 01", // header
        "02 76 67 02 6e 6f 00 00 1c 00 01", // vg.no AAAA IN
        "00 00 29 04 d0 00 00 00 00 00 00", // OPT, 1232-byte buffer
      ].join(" ")
    );
  });

  test("rejects labels longer than 63 bytes", () => {
    const error = Effect.runSync(
      Effect.flip(encodeQuery(1, `${"a".repeat(longestLabel + 1)}.no`, "A"))
    );
    expect(error._tag).toBe("MalformedResponse");
  });
});

describe("decodeResponse: records", () => {
  test("reads A, AAAA and CNAME records", () => {
    const answer = decode(
      response({
        records: [
          { name: "www.example.com", type: "CNAME", value: "example.com" },
          { name: "example.com", type: "A", value: "192.0.2.10" },
          { name: "example.com", type: "AAAA", value: "2001:db8::10" },
        ],
      })
    );
    expect(answer.rcode).toBe(Rcode.noError);
    expect(answer.records.map((r) => r.value)).toEqual([
      "example.com",
      "192.0.2.10",
      "2001:db8::10",
    ]);
  });

  test("follows compression pointers", () => {
    const bytes = hex(`
      00 01 81 80 00 01 00 01 00 00 00 00
      03 77 77 77 07 65 78 61 6d 70 6c 65 03 63 6f 6d 00 00 01 00 01
      c0 0c 00 05 00 01 00 00 00 3c 00 02 c0 10
    `);
    expect(decode(bytes).records).toEqual([
      { name: "www.example.com", type: "CNAME", value: "example.com" },
    ]);
  });
});

describe("decodeResponse: flags and errors", () => {
  test("reads Extended DNS Errors and the extended rcode", () => {
    const answer = decode(
      response({
        extendedErrors: [{ code: edeFiltered, text: "malware" }],
        rcode: extendedRcode,
      })
    );
    expect(answer.extendedErrors).toEqual([
      { code: edeFiltered, text: "malware" },
    ]);
    expect(answer.rcode).toBe(extendedRcode);
  });

  test("reports truncation", () => {
    expect(decode(response({ truncated: true })).truncated).toBe(true);
    expect(decode(response({})).truncated).toBe(false);
  });

  test("fails on a cut-short message", () => {
    const whole = response({
      records: [{ name: "example.com", type: "A", value: "192.0.2.1" }],
    });
    expect(decodeError(whole.subarray(0, -1))._tag).toBe("MalformedResponse");
  });

  test("fails on a compression loop", () => {
    const bytes = hex("00 01 81 80 00 01 00 00 00 00 00 00 c0 0c");
    expect(decodeError(bytes).reason).toBe("name compression loop");
  });
});

describe("decodeResponse: malformed records", () => {
  const header = (answers: number) =>
    `00 01 81 80 00 01 00 0${answers} 00 00 00 00
     07 65 78 61 6d 70 6c 65 03 63 6f 6d 00 00 01 00 01`;
  const reason = (s: string) => decodeError(hex(s)).reason;

  test("fails on an address of the wrong size", () => {
    const zeros = (n: number) =>
      Array.from({ length: n }, () => "00").join(" ");
    const ipv4 = 4;
    const ipv6 = 16;
    expect(
      reason(`${header(1)} c0 0c 00 01 00 01 00 00 00 3c 00 03 c0 00 02`)
    ).toBe("bad A record");
    expect(
      reason(`${header(1)} c0 0c 00 01 00 01 00 00 00 3c 00 10 ${zeros(ipv6)}`)
    ).toBe("bad A record");
    expect(
      reason(`${header(1)} c0 0c 00 1c 00 01 00 00 00 3c 00 04 ${zeros(ipv4)}`)
    ).toBe("bad AAAA record");
  });

  test("keeps a CNAME within its record", () => {
    // An empty CNAME, then an A record the target must not be read from.
    expect(
      reason(`${header(2)}
        c0 0c 00 05 00 01 00 00 00 3c 00 00
        c0 0c 00 01 00 01 00 00 00 3c 00 04 c0 00 02 01`)
    ).toBe("bad CNAME record");
    // A CNAME target that runs past the record's two bytes.
    expect(
      reason(
        `${header(1)} c0 0c 00 05 00 01 00 00 00 3c 00 02 03 77 77 77 c0 0c`
      )
    ).toBe("bad CNAME record");
  });
});
