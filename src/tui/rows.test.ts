import { describe, expect, test } from "bun:test";
import type { Filter } from "../check/filters.ts";
import { type CheckResult, cancelPending, pending } from "../check/result.ts";
import {
  computer,
  computerWith,
  fakeCanary,
  fakeFilters,
  publicTestPage,
} from "../testing/fake-network.ts";
import { downRealAnswerUrl, runCheck } from "../testing/run-check.ts";
import { flatRows, type TableRow, tableGroups } from "./rows.ts";

const row = (r: CheckResult, name: string): TableRow | undefined =>
  flatRows(tableGroups(r, [])).find((x) => x.name === name);

describe("tableGroups", () => {
  test("Cisco's inspection proxy shows as inspected", async () => {
    const r = await runCheck("grey.example");
    expect(row(r, "Security filter")).toMatchObject({
      state: "inspected",
      word: "inspected",
    });
  });

  test("a filter's NXDOMAIN without the real answer can't be told", async () => {
    const r = await runCheck("nope.example", {
      unfilteredResolvers: [downRealAnswerUrl],
    });
    expect(row(r, "Family filter")).toMatchObject({
      state: "unsure",
      word: "can't tell",
    });
  });

  test("a filter's NXDOMAIN while the real answer is on its way is not found", async () => {
    const r = await runCheck("nope.example");
    const sofar: CheckResult = { ...r, realAnswer: pending };
    expect(row(sofar, "Family filter")).toMatchObject({
      state: "missing",
      word: "not found",
    });
  });

  test("a real answer that failed shows the error, not the resolver", async () => {
    const r = await runCheck("good.example", {
      unfilteredResolvers: [downRealAnswerUrl],
    });
    expect(row(r, "Real answer")).toMatchObject({
      ms: "",
      response: [expect.stringContaining("timed out")],
      server: "DNS over HTTPS",
      state: "failed",
      word: "no answer",
    });
  });

  test("this computer finding no address says so", async () => {
    const r = await runCheck("mail.example");
    expect(row(r, "Your DNS")).toMatchObject({
      response: ["no answer records", "no address on this computer"],
      state: "missing",
      word: "no address",
    });
    expect(row(r, "Your DNS")?.why).toContain("not a block");
  });
});

describe("tableGroups after a cancel", () => {
  test("the real answer that was still on its way says cancelled", async () => {
    const r = await runCheck("good.example");
    const waiting: CheckResult = { ...r, realAnswer: pending };
    expect(row(cancelPending(waiting), "Real answer")).toMatchObject({
      ms: "",
      response: [],
      server: "DNS over HTTPS",
      state: "cancelled",
      word: "cancelled",
    });
  });

  test("a filter or this computer still on its way says cancelled", async () => {
    const r = await runCheck("good.example");
    const waiting: CheckResult = {
      ...r,
      filters: r.filters.map((f) => ({ ...f, outcome: pending })),
      system: pending,
    };
    const cancelled = {
      answer: "",
      ms: "0",
      response: ["error: cancelled"],
      state: "cancelled",
      word: "cancelled",
    };
    const after = cancelPending(waiting);
    expect(row(after, "Your DNS")).toMatchObject(cancelled);
    expect(row(after, "Security filter")).toMatchObject(cancelled);
  });
});

describe("tableGroups for a filter that only answers its own network", () => {
  const ispFilter: Filter = {
    canary: fakeCanary,
    category: "security",
    name: "ISP filter",
    onlyAnswers: { customers: "Telenor customers", network: "Telenor" },
    servers: ["203.0.113.1"],
  };
  const filters = [...fakeFilters, ispFilter];

  test("not answering elsewhere is explained as expected", async () => {
    const r = await runCheck("good.example", {
      dns: computerWith(publicTestPage),
      filters,
    });
    const isp = row(r, "ISP filter");
    expect(isp).toMatchObject({ state: "optional", word: "no answer" });
    expect(isp?.why).toContain("can't be asked from this network");
  });

  test("not answering on its own network is explained as incomplete", async () => {
    // This computer's DNS goes through Nettvern+, so it is on Telenor's network.
    const r = await runCheck("good.example", { dns: computer, filters });
    const isp = row(r, "ISP filter");
    expect(isp).toMatchObject({ state: "failed", word: "no answer" });
    expect(isp?.why).toContain("should answer this computer");
  });
});
