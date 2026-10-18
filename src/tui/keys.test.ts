import { expect, test } from "bun:test";
import { actionFor, footerText } from "./keys.ts";
import { initialState } from "./state.ts";

const key = (name: string, ctrl = false) => ({ ctrl, name, sequence: name });
const typing = initialState("1.0.0");
const browsing = { ...typing, focus: "table" as const };
const narrow = 40;
/** The width inside a 120 and a 170 column terminal. */
const tight = 118;
const roomy = 168;

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

test("help and the connection screen scroll", () => {
  const help = { ...browsing, screen: "help" as const };
  const connection = { ...browsing, screen: "connection" as const };
  expect(actionFor(help, key("j"))).toBe("scrollDown");
  expect(actionFor(help, key("pageup"))).toBe("scrollPageUp");
  expect(actionFor(connection, key("k"))).toBe("scrollUp");
  expect(actionFor(connection, key("pagedown"))).toBe("scrollPageDown");
});

test("the footer wraps between keys, not inside them", () => {
  const text = footerText(browsing, narrow)
    .chunks.map((c) => c.text)
    .join("");
  for (const line of text.split("\n")) {
    expect(line.trimEnd().length).toBeLessThanOrEqual(narrow);
  }
  expect(text).toContain(" e  export JSON");
});

test("a message too long for the keys' line gets a line of its own", () => {
  const toast = "saved nbchecker-bad.example.json";
  const plain = (w: number) =>
    footerText({ ...browsing, toast }, w)
      .chunks.map((c) => c.text)
      .join("")
      .split("\n");
  expect(plain(roomy)).toHaveLength(1);
  const lines = plain(tight);
  expect(lines.at(-1)).toBe(toast);
  for (const line of lines) {
    expect(line.trimEnd().length).toBeLessThanOrEqual(tight);
  }
});
