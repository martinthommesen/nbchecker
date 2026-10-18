import { describe, expect, test } from "bun:test";
import { wrap } from "./paint.ts";

const address = ["2001:db8:1234:5678", "abcd:ef12:3456:789a"].join(":");
const width = 30;
const wide = 45;
const hang = 2;

describe("wrap", () => {
  test("breaks at spaces, indenting the lines after the first", () => {
    expect(wrap(`example.com. AAAA ${address}`, wide, hang)).toEqual([
      "example.com. AAAA",
      `  ${address}`,
    ]);
  });

  test("breaks inside a word too long for a line", () => {
    const parts = wrap(address, width, hang);
    expect(parts.join("").replaceAll(" ", "")).toBe(address);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(width);
    }
  });

  test("keeps the indent a line starts with", () => {
    expect(wrap(`  CNAME ${address}`, width, hang)).toEqual([
      "  CNAME",
      `    ${address.slice(0, width - hang - hang)}`,
      `    ${address.slice(width - hang - hang)}`,
    ]);
  });

  test("leaves a line that fits alone", () => {
    expect(wrap("example.com. A 192.0.2.1", width)).toEqual([
      "example.com. A 192.0.2.1",
    ]);
  });
});
