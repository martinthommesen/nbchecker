import { expect, test } from "bun:test";
import { Ede, Rcode } from "../dns/codes.ts";
import { a, aaaa, answer, cname } from "../testing/records.ts";
import { answerSummary, responseLines } from "./answer.ts";

test("a CNAME block shows the block page's name", () => {
  const blocked = answer([
    cname("example.com", "nettvern-info.telenor.net"),
    a("nettvern-info.telenor.net", "192.0.2.1"),
  ]);
  expect(answerSummary([blocked], "nettvern")).toBe(
    "CNAME nettvern-info.telenor.net"
  );
  expect(responseLines([blocked])).toEqual([
    "example.com. CNAME",
    "  nettvern-info.telenor.net.",
    "nettvern-info.telenor.net. A 192.0.2.1",
  ]);
});

test("addresses show the first and count the rest", () => {
  const v4 = answer([
    a("example.com", "192.0.2.1"),
    a("example.com", "192.0.2.2"),
  ]);
  const v6 = answer([aaaa("example.com", "2001:db8::1")]);
  expect(answerSummary([v4, v6])).toBe("A 192.0.2.1 +2");
});

test("an error shows its status and Extended DNS Error", () => {
  const failed = answer([], {
    extendedErrors: [{ code: Ede.blocked, text: "malware" }],
    rcode: Rcode.nxDomain,
  });
  expect(answerSummary([failed], "ede")).toBe("NXDOMAIN · EDE 15");
  expect(responseLines([failed])).toEqual([
    "status: NXDOMAIN",
    "EDE 15 (Blocked): malware",
    "no answer records",
  ]);
  expect(answerSummary([answer([])])).toBe("no records");
});
