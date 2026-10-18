import { expect, test } from "bun:test";
import { filters } from "./filters.ts";

const canaryOf = (name: string) => filters.find((f) => f.name === name)?.canary;

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
