import { expect, test } from "bun:test";
import { Effect } from "effect";
import { Dns } from "effect/net";
import { detectConnection } from "./connection.ts";
import { shouldAnswer } from "./evidence.ts";
import { filters } from "./filters.ts";
import { telenorTestPage } from "./known-answers.ts";
import { type CheckResult, unchecked } from "./result.ts";

const canaryOf = (name: string) => filters.find((f) => f.name === name)?.canary;

/** A result on a computer that gets `ip` for Telenor's test page. */
const resultOn = async (ip: string): Promise<CheckResult> => {
  const connection = await detectConnection.pipe(
    Effect.provide(
      Dns.layerStatic({ hosts: { [telenorTestPage.name]: [ip] } })
    ),
    Effect.runPromise
  );
  return {
    ...unchecked("example.com", "example.com", false),
    network: { connection, selfTests: [] },
  };
};

test("Telenor's filters self-test with their own test page answer", () => {
  expect(canaryOf("Telenor Nettvern")).toEqual({
    answers: ["148.123.15.38"],
    name: "nettvern.telenor.net",
  });
  expect(canaryOf("Telenor Nettvern+")).toEqual({
    answers: ["148.123.15.1"],
    name: "nettvern.telenor.net",
  });
});

test("Telenor's filters should answer where the test page finds Telenor", async () => {
  const telenor = filters.filter((f) => f.onlyAnswers !== undefined);
  expect(telenor.map((f) => f.name)).toEqual([
    "Telenor Nettvern",
    "Telenor Nettvern+",
  ]);
  const onTelenor = await resultOn("148.123.15.38");
  expect(telenor.map((f) => shouldAnswer(onTelenor, f))).toEqual([true, true]);
  // The public answer: not on Telenor's network.
  const elsewhere = await resultOn("148.123.15.37");
  expect(telenor.map((f) => shouldAnswer(elsewhere, f))).toEqual([
    false,
    false,
  ]);
});
