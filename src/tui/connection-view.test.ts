import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { Dns } from "effect/net";
import { type Connection, detectConnection } from "../check/connection.ts";
import { telenorTestPage } from "../check/known-answers.ts";
import { detectedText, howText } from "./connection-view.ts";
import { plainText } from "./paint.ts";

const failed: Connection = {
  error: "timed out",
  filter: undefined,
  network: undefined,
  testAnswers: [],
};

const plain = (c: Connection): string => plainText(howText(c, 0));

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

test("the test page's public answer is not shown as Telenor's DNS", async () => {
  const c = await detectConnection.pipe(
    Effect.provide(
      Dns.layerStatic({ hosts: { [telenorTestPage.name]: ["148.123.15.37"] } })
    ),
    Effect.runPromise
  );
  const text = plainText(detectedText(c, 0));
  expect(text).toContain("No filter detected");
  expect(text).not.toContain("Telenor's DNS");
  expect(plain(c)).toContain("public answer");
});
