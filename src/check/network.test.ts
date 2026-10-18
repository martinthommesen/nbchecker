import { describe, expect, test } from "bun:test";
import { Effect, type Layer } from "effect";
import type { DnsTransport } from "../dns/transport.ts";
import {
  computer,
  fakeFilters,
  fakeTransport,
  redirectingTransport,
} from "../testing/fake-network.ts";
import { CheckerOptions } from "./checker.ts";
import type { Filter } from "./filters.ts";
import { detectNetwork } from "./network.ts";
import { redirectedFilters, seemsIntercepted } from "./result.ts";

const testPage = "nettvern.telenor.net";

/** A Telenor filter whose server, 192.0.2.53, gives Nettvern's answer. */
const telenor = (answer: string, servers = ["192.0.2.53"]): Filter => ({
  canary: { answer, name: testPage },
  category: "security",
  name: "Telenor filter",
  network: "Telenor",
  onlyAnswers: "Telenor customers",
  servers,
});

const detect = (
  transport: Layer.Layer<DnsTransport> = fakeTransport,
  filters: readonly Filter[] = fakeFilters
) =>
  detectNetwork.pipe(
    Effect.provideService(CheckerOptions, { filters, truthUrls: [] }),
    Effect.provide(transport),
    Effect.provide(computer),
    Effect.runPromise
  );

const results = async (...args: Parameters<typeof detect>) =>
  (await detect(...args)).selfTests.map((t) => t.result);

describe("self-test", () => {
  test("filters that block their canary pass", async () => {
    const n = await detect();
    expect(n.selfTests.map((t) => t.result)).toEqual(["passed", "passed"]);
    expect(seemsIntercepted(n)).toBe(false);
    expect(n.connection.filter).toBe("Telenor Nettvern+");
  });

  test("on a redirecting network every filter fails", async () => {
    const n = await detect(redirectingTransport());
    expect(n.selfTests).toMatchObject([
      {
        answers: ["192.0.2.5"],
        filter: "Security filter",
        result: "redirected",
      },
      { answers: ["192.0.2.5"], filter: "Family filter", result: "redirected" },
    ]);
    expect(redirectedFilters(n)).toEqual(["Security filter", "Family filter"]);
    expect(seemsIntercepted(n)).toBe(true);
  });

  test("one redirected filter of two is not an intercepted network", async () => {
    const n = await detect(redirectingTransport(["198.51.100.53"]));
    expect(n.selfTests.map((t) => t.result)).toEqual(["passed", "redirected"]);
    expect(seemsIntercepted(n)).toBe(false);
  });

  test("a canary with no answer is unknown, not failed", async () => {
    const [security, family] = fakeFilters;
    const quiet = [
      // Its server refuses this name.
      { ...security, canary: { name: "refused.example" } },
      { ...family, servers: ["203.0.113.1"] },
    ] as Filter[];
    const n = await detect(fakeTransport, quiet);
    expect(n.selfTests.map((t) => t.result)).toEqual([
      "no-answer",
      "no-answer",
    ]);
    expect(seemsIntercepted(n)).toBe(false);
  });

  test("Telenor's filters must answer their own test page address", async () => {
    expect(await results(fakeTransport, [telenor("148.123.15.38")])).toEqual([
      "passed",
    ]);
    // Nettvern's answer where Nettvern+'s was expected.
    expect(await results(fakeTransport, [telenor("148.123.15.1")])).toEqual([
      "redirected",
    ]);
    // The public answer, as a redirecting network gives it.
    expect(
      await results(redirectingTransport(), [telenor("148.123.15.38")])
    ).toEqual(["redirected"]);
  });

  test("Telenor's filters not answering off its network is no answer", async () => {
    const off = telenor("148.123.15.38", ["203.0.113.1"]);
    expect(await results(fakeTransport, [off])).toEqual(["no-answer"]);
  });
});
