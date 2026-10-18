import { expect, test } from "bun:test";
import { type CheckResult, unchecked } from "../check/result.ts";
import { exitBlocked, exitCode, exitIncomplete } from "./json.ts";

const checked: CheckResult = {
  ...unchecked("example.com", "example.com", false),
  checked: true,
  exists: true,
  system: {
    exchange: {
      answers: [],
      ms: 1,
      server: "this computer",
      transport: "system resolver",
    },
    kind: "answered",
    verdict: {
      answers: [],
      blocked: false,
      detail: "",
      missing: false,
      reason: undefined,
    },
  },
};

test("a clean check exits 0", () => {
  expect(exitCode([checked])).toBe(0);
});

test("a failed real answer or system lookup makes the check incomplete", () => {
  expect(exitCode([{ ...checked, truthError: "timed out" }])).toBe(
    exitIncomplete
  );
  expect(
    exitCode([
      { ...checked, system: { error: "timed out", kind: "failed", ms: 1 } },
    ])
  ).toBe(exitIncomplete);
});

test("a block exits 1", () => {
  const blocked: CheckResult = {
    ...checked,
    system: {
      exchange: {
        answers: [],
        ms: 1,
        server: "this computer",
        transport: "system resolver",
      },
      kind: "answered",
      verdict: {
        answers: ["0.0.0.0"],
        blocked: true,
        detail: "",
        missing: false,
        reason: "null-ip",
      },
    },
  };
  expect(exitCode([blocked])).toBe(exitBlocked);
  // A definite block wins over a lookup that didn't answer.
  expect(exitCode([{ ...blocked, truthError: "timed out" }])).toBe(
    exitBlocked
  );
});
