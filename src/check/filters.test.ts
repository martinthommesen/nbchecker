import { expect, test } from "bun:test";
import { Effect, type Layer } from "effect";
import { Dns } from "effect/net";
import { failingComputer } from "../testing/fake-network.ts";
import { detectConnection } from "./connection.ts";
import { shouldAnswer } from "./evidence.ts";
import { filters } from "./filters.ts";
import { telenorTestPage } from "./known-answers.ts";
import { type CheckResult, unchecked } from "./result.ts";

const canaryOf = (name: string) => filters.find((f) => f.name === name)?.canary;

const telenor = filters.filter((f) => f.onlyAnswers !== undefined);

/** A computer whose DNS gets `ip` for Telenor's test page. */
const gettingTestPage = (ip: string) =>
  Dns.layerStatic({ hosts: { [telenorTestPage.name]: [ip] } });

/** A result on a computer whose own DNS is `dns`. */
const resultOn = async (
  dns: Layer.Layer<Dns.Dns, unknown>
): Promise<CheckResult> => {
  const connection = await detectConnection.pipe(
    Effect.provide(dns),
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
  expect(telenor.map((f) => f.name)).toEqual([
    "Telenor Nettvern",
    "Telenor Nettvern+",
  ]);
  const onTelenor = await resultOn(gettingTestPage("148.123.15.38"));
  expect(telenor.map((f) => shouldAnswer(onTelenor, f))).toEqual([true, true]);
  // The public answer: not on Telenor's network.
  const elsewhere = await resultOn(gettingTestPage("148.123.15.37"));
  expect(telenor.map((f) => shouldAnswer(elsewhere, f))).toEqual([
    false,
    false,
  ]);
});

test("Telenor's filters should answer when the test page lookup fails", async () => {
  // Nobody can tell whether this is Telenor's network, so their silence
  // leaves the check incomplete rather than expected.
  const unknown = await resultOn(failingComputer);
  expect(unknown.network?.connection.error).toBeDefined();
  expect(telenor.map((f) => shouldAnswer(unknown, f))).toEqual([true, true]);
});
