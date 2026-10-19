import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { DnsTransport } from "../dns/transport.ts";
import {
  blockingRedirectTransport,
  computer,
  fakeFilters,
  fakeOptions,
  fakeTransport,
  familyFilter,
  nettvernPlusTestPage,
  nettvernTestPage,
  redirectingTransport,
  securityFilter,
  testPageName,
  untestedSecurityFilter,
} from "../testing/fake-network.ts";
import { a, aaaa, answer } from "../testing/records.ts";
import { redirectedFilters, seemsIntercepted } from "./evidence.ts";
import type { Filter } from "./filters.ts";
import { detectNetwork } from "./network.ts";
import { CheckerOptions } from "./options.ts";

/**
 * A Telenor filter that expects `ip` for Telenor's test page. Its server,
 * 192.0.2.53 by default, gives Nettvern's answer.
 */
const telenor = (ip: string, servers = ["192.0.2.53"]): Filter => ({
  canary: { answers: [ip], name: testPageName },
  category: "security",
  name: "Telenor filter",
  onlyAnswers: { customers: "Telenor customers", network: "Telenor" },
  servers,
});

const detect = (
  transport: Layer.Layer<DnsTransport> = fakeTransport,
  filters: readonly Filter[] = fakeFilters
) =>
  detectNetwork.pipe(
    Effect.provideService(CheckerOptions, { ...fakeOptions, filters }),
    Effect.provide(transport),
    Effect.provide(computer),
    Effect.runPromise
  );

/** Every filter blocks the canary over IPv4, but IPv6 queries go elsewhere. */
const redirectedIpv6 = Layer.succeed(DnsTransport, {
  ask: (_server, name, type) => {
    if (type === "A") {
      return Effect.succeed(answer([a(name, "0.0.0.0")]));
    }
    return Effect.succeed(answer([aaaa(name, "2001:db8::5")]));
  },
  doh: (_url, name) => Effect.succeed(answer([a(name, "192.0.2.5")])),
});

const results = async (...args: Parameters<typeof detect>) =>
  (await detect(...args)).selfTests.map((t) => t.result);

/** Umbrella answers AAAA queries with its IPv4 block page, mapped to IPv6. */
const umbrellaLike = Layer.succeed(DnsTransport, {
  ask: (_server, name, type) => {
    if (type === "A") {
      return Effect.succeed(answer([a(name, "146.112.61.106")]));
    }
    return Effect.succeed(answer([aaaa(name, "::ffff:146.112.61.106")]));
  },
  doh: (_url, name) => Effect.succeed(answer([a(name, "192.0.2.5")])),
});

describe("self-test: every address counts", () => {
  test("one address that isn't the block answer fails it", async () => {
    expect(await results(redirectedIpv6)).toEqual(["redirected", "redirected"]);
  });

  test("a block page mapped to IPv6 is the same block", async () => {
    const filters = fakeFilters.map((f) => ({
      ...f,
      canary: { answers: ["146.112.61.106"], name: "canary.example" },
    }));
    expect(await results(umbrellaLike, filters)).toEqual(["passed", "passed"]);
  });
});

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
    const quiet = [
      // Its server refuses this name.
      {
        ...securityFilter,
        canary: { answers: ["0.0.0.0"], name: "refused.example" },
      },
      { ...familyFilter, servers: ["203.0.113.1"] },
    ];
    const n = await detect(fakeTransport, quiet);
    expect(n.selfTests.map((t) => t.result)).toEqual([
      "no-answer",
      "no-answer",
    ]);
    expect(seemsIntercepted(n)).toBe(false);
  });

  test("Telenor's filters must answer their own test page address", async () => {
    const nettvern = telenor(nettvernTestPage);
    expect(await results(fakeTransport, [nettvern])).toEqual(["passed"]);
    // Nettvern's answer where Nettvern+'s was expected.
    const nettvernPlus = telenor(nettvernPlusTestPage);
    expect(await results(fakeTransport, [nettvernPlus])).toEqual([
      "redirected",
    ]);
    // The public answer, as a redirecting network gives it.
    expect(await results(redirectingTransport(), [nettvern])).toEqual([
      "redirected",
    ]);
  });

  test("Telenor's filters not answering off its network is no answer", async () => {
    const off = telenor(nettvernTestPage, ["203.0.113.1"]);
    expect(await results(fakeTransport, [off])).toEqual(["no-answer"]);
  });
});

describe("self-test without a test name", () => {
  test("a filter with no documented test name isn't self-tested", async () => {
    const n = await detect(redirectingTransport(), [
      untestedSecurityFilter,
      familyFilter,
    ]);
    expect(n.selfTests.map((t) => t.result)).toEqual([
      "untested",
      "redirected",
    ]);
    expect(redirectedFilters(n)).toEqual(["Family filter"]);
  });

  test("one redirected filter, when the others can't tell, isn't an intercepted network", async () => {
    const n = await detect(redirectingTransport(), [
      untestedSecurityFilter,
      familyFilter,
    ]);
    expect(redirectedFilters(n)).toEqual(["Family filter"]);
    expect(seemsIntercepted(n)).toBe(false);
  });

  test("a block that isn't the filter's own doesn't pass", async () => {
    // The resolver the network uses answers 0.0.0.0, like the family filter;
    // the security filter's own block is a CNAME to its warning page.
    const ownBlocks = [
      {
        ...securityFilter,
        canary: { answers: ["148.123.15.44"], name: "canary.example" },
      },
      familyFilter,
    ];
    expect(await results(blockingRedirectTransport, ownBlocks)).toEqual([
      "redirected",
      "passed",
    ]);
  });
});
