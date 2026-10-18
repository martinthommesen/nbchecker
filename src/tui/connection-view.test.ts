import { describe, expect, test } from "bun:test";
import type { Connection } from "../check/connection.ts";
import { howText } from "./connection-view.ts";

const failed: Connection = {
  error: "timed out",
  filter: undefined,
  network: undefined,
  testAnswers: [],
};

const plain = (c: Connection): string =>
  howText(c, 0)
    .chunks.map((ch) => ch.text)
    .join("");

describe("howText", () => {
  test("a failed test lookup is marked as unknown, not as no filter", () => {
    expect(plain(failed)).toContain("? nettvern.telenor.net");
    expect(plain(failed)).toContain("lookup failed");
  });

  test("a test lookup with no recognised answer is marked as not seen", () => {
    const text = plain({ ...failed, error: undefined });
    expect(text).toContain("· nettvern.telenor.net");
  });
});
