import { expect, test } from "bun:test";
import { actionFor, footerText } from "./keys.ts";
import { initialState } from "./state.ts";

const key = (name: string, ctrl = false) => ({ ctrl, name, sequence: name });
const typing = initialState("1.0.0");
const browsing = { ...typing, focus: "table" as const };
const narrow = 40;

test("letters are typed while the input has focus, and act otherwise", () => {
  expect(actionFor(typing, key("q"))).toBeUndefined();
  expect(actionFor(typing, key("up"))).toBe("historyUp");
  expect(actionFor(browsing, key("q"))).toBe("quit");
  expect(actionFor(browsing, key("up"))).toBe("up");
  expect(actionFor(browsing, key("/"))).toBe("newCheck");
});

test("ctrl+c quits anywhere", () => {
  expect(actionFor(typing, key("c", true))).toBe("quit");
  expect(actionFor({ ...browsing, screen: "help" }, key("c", true))).toBe(
    "quit"
  );
});

test("each screen has its own keys", () => {
  expect(actionFor({ ...browsing, screen: "connection" }, key("r"))).toBe(
    "detect"
  );
  expect(actionFor({ ...browsing, screen: "help" }, key("escape"))).toBe(
    "back"
  );
});

test("the footer wraps between keys, not inside them", () => {
  const text = footerText(browsing, narrow)
    .chunks.map((c) => c.text)
    .join("");
  for (const line of text.split("\n")) {
    expect(line.trimEnd().length).toBeLessThanOrEqual(narrow);
  }
  expect(text).toContain("e export JSON");
});
