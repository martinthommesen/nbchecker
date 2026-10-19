import { expect, test } from "bun:test";
import { runCheck } from "../testing/run-check.ts";
import { completionOf } from "./evidence.ts";

test("a lookup cut short by a cancel counts as one that failed", async () => {
  const r = await runCheck("good.example");
  const cancelled = { kind: "cancelled" } as const;
  expect(completionOf(r)).toBe("complete");
  expect(completionOf({ ...r, system: cancelled })).toBe("incomplete");
  expect(completionOf({ ...r, realAnswer: cancelled })).toBe("incomplete");
  const filters = r.filters.map((f) => ({ ...f, outcome: cancelled }));
  expect(completionOf({ ...r, filters })).toBe("incomplete");
});
