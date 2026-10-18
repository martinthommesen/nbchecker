import { describe, expect, test } from "bun:test";
import type { CheckResult } from "../check/result.ts";
import { downTruthUrl, runCheck } from "../testing/run-check.ts";
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
    const r = await runCheck("nope.example", { truthUrls: [downTruthUrl] });
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
