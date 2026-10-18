import { describe, expect, test } from "bun:test";
import { type CheckResult, cancelPending } from "../check/result.ts";
import { downRealAnswerUrl, runCheck } from "../testing/run-check.ts";
import { flatRows, resultGroups, type TableRow } from "./rows.ts";

const row = (r: CheckResult, name: string): TableRow | undefined =>
  flatRows(resultGroups(r)).find((x) => x.name === name);

describe("resultGroups", () => {
  test("Cisco's inspection proxy shows as inspected", async () => {
    const r = await runCheck("grey.example");
    expect(row(r, "Security filter")).toMatchObject({
      state: "inspected",
      verdict: "inspected",
    });
  });

  test("a filter's NXDOMAIN without the real answer can't be told", async () => {
    const r = await runCheck("nope.example", {
      unfilteredResolvers: [downRealAnswerUrl],
    });
    expect(row(r, "Family filter")).toMatchObject({
      state: "unsure",
      verdict: "can't tell",
    });
  });

  test("this computer finding no address says so", async () => {
    const r = await runCheck("mail.example");
    expect(row(r, "Your DNS")).toMatchObject({
      response: ["no answer records", "no address on this computer"],
      state: "missing",
      verdict: "no address",
    });
    expect(row(r, "Your DNS")?.why).toContain("not a block");
  });
});

describe("resultGroups after a cancel", () => {
  test("the real answer that was still on its way says cancelled", async () => {
    const r = await runCheck("good.example");
    const waiting = {
      ...r,
      realAnswerError: undefined,
      realAnswerExchange: undefined,
    };
    expect(row(cancelPending(waiting), "Real answer")).toMatchObject({
      response: [],
      state: "unavailable",
      verdict: "cancelled",
    });
  });
});
