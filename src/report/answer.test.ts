import { expect, test } from "bun:test";
import { Ede, Rcode } from "../dns/codes.ts";
import type { DnsAnswer } from "../dns/wire.ts";
import { answerSummary, responseLines } from "./answer.ts";

const answer = (fields: Partial<DnsAnswer>): DnsAnswer => ({
  extendedErrors: [],
  rcode: Rcode.noError,
  records: [],
  truncated: false,
  ...fields,
});

test("a CNAME block shows the block page's name", () => {
  const a = answer({
    records: [
      {
        name: "example.com",
        type: "CNAME",
        value: "nettvern-info.telenor.net",
      },
      { name: "nettvern-info.telenor.net", type: "A", value: "192.0.2.1" },
    ],
  });
  expect(answerSummary([a], "nettvern")).toBe(
    "CNAME nettvern-info.telenor.net"
  );
  expect(responseLines([a])).toEqual([
    "example.com. CNAME",
    "  nettvern-info.telenor.net.",
    "nettvern-info.telenor.net. A 192.0.2.1",
  ]);
});

test("addresses show the first and count the rest", () => {
  const a = answer({
    records: [
      { name: "example.com", type: "A", value: "192.0.2.1" },
      { name: "example.com", type: "A", value: "192.0.2.2" },
    ],
  });
  const aaaa = answer({
    records: [{ name: "example.com", type: "AAAA", value: "2001:db8::1" }],
  });
  expect(answerSummary([a, aaaa])).toBe("A 192.0.2.1 +2");
});

test("an error shows its status and Extended DNS Error", () => {
  const a = answer({
    extendedErrors: [{ code: Ede.blocked, text: "malware" }],
    rcode: Rcode.nxDomain,
  });
  expect(answerSummary([a], "ede")).toBe("NXDOMAIN · EDE 15");
  expect(responseLines([a])).toEqual([
    "status: NXDOMAIN",
    "EDE 15 (Blocked): malware",
    "no answer records",
  ]);
  expect(answerSummary([answer({})])).toBe("no records");
});
