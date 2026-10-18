import { describe, expect, test } from "bun:test";
import { classify, type Reference } from "../check/classify.ts";
import { Rcode } from "../dns/codes.ts";
import { a, answer, noRecords } from "../testing/records.ts";
import { reasonWhy, verdictText } from "./reasons.ts";

/** The real answer for a name that exists, with an address of its own. */
const exists: Reference = { addresses: ["192.0.2.20"], exists: true };
const missing: Reference = { addresses: [], exists: false };

describe("verdictText", () => {
  test("a name that doesn't exist is not found", () => {
    const v = classify(noRecords(Rcode.nxDomain), missing);
    expect(verdictText(v)).toBe("not found (the domain doesn't exist)");
  });

  test("a block says its detail, such as the Umbrella category", () => {
    const v = classify(answer([a("x.example", "146.112.61.108")]), exists);
    expect(verdictText(v)).toBe("blocked by Cisco Umbrella (phishing)");
  });

  test("Cisco's inspection proxy is not called a block", () => {
    const v = classify(answer([a("grey.example", "146.112.56.167")]), exists);
    expect(verdictText(v)).toBe(
      "sent through Cisco's inspection proxy; the site may still be blocked by URL"
    );
  });
});

test("reasonWhy names whose answer it is and the error it gave", () => {
  expect(reasonWhy("ede", "Quad9", "Blocked")).toBe(
    "Quad9 says outright that it blocked the domain, using an Extended DNS Error (Blocked)."
  );
});
