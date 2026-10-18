import { expect, test } from "bun:test";
import { footerText } from "./footer.ts";
import { initialState } from "./state.ts";

const browsing = { ...initialState("1.0.0"), focus: "table" as const };
const narrow = 40;
/** The width inside a 120 and a 170 column terminal. */
const tight = 118;
const roomy = 168;

const plainLines = (s: typeof browsing, width: number): string[] =>
  footerText(s, width)
    .chunks.map((c) => c.text)
    .join("")
    .split("\n");

test("the footer wraps between keys, not inside them", () => {
  const lines = plainLines(browsing, narrow);
  for (const line of lines) {
    expect(line.trimEnd().length).toBeLessThanOrEqual(narrow);
  }
  expect(lines.join("\n")).toContain(" e  export JSON");
});

test("a message too long for the keys' line gets a line of its own", () => {
  const toast = "saved nbchecker-bad.example.json";
  expect(plainLines({ ...browsing, toast }, roomy)).toHaveLength(1);
  const lines = plainLines({ ...browsing, toast }, tight);
  expect(lines.at(-1)).toBe(toast);
  for (const line of lines) {
    expect(line.trimEnd().length).toBeLessThanOrEqual(tight);
  }
});
