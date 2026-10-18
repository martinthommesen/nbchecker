import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { Rcode } from "../dns/codes.ts";
import { DnsTransport } from "../dns/transport.ts";
import type { DnsAnswer } from "../dns/wire.ts";
import {
  blockingRedirectTransport,
  computer,
  fakeFilters,
  fakeTransport,
  redirectingTransport,
} from "../testing/fake-network.ts";
import type { Filter } from "./filters.ts";
import { detectNetwork } from "./network.ts";
import { CheckerOptions } from "./options.ts";
import { redirectedFilters, seemsIntercepted } from "./result.ts";

const testPage = "nettvern.telenor.net";

/** A Telenor filter whose server, 192.0.2.53, gives Nettvern's answer. */
const telenor = (answer: string, servers = ["192.0.2.53"]): Filter => ({
  canary: { answers: [answer], name: testPage },
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
    Effect.provideService(CheckerOptions, { filters, truthUrls: [] }),
    Effect.provide(transport),
    Effect.provide(computer),
    Effect.runPromise
  );

const dnsAnswer = (
  name: string,
  type: "A" | "AAAA",
  value: string
): DnsAnswer => ({
  extendedErrors: [],
  rcode: Rcode.noError,
  records: [{ name, type, value }],
  truncated: false,
});

/** Every filter blocks the canary over IPv4, but IPv6 queries go elsewhere. */
const redirectedIpv6 = Layer.succeed(DnsTransport, {
  ask: (_server, name, type) => {
    if (type === "A") {
      return Effect.succeed(dnsAnswer(name, type, "0.0.0.0"));
    }
    return Effect.succeed(dnsAnswer(name, type, "2001:db8::5"));
  },
  doh: (_url, name, type) => Effect.succeed(dnsAnswer(name, type, "192.0.2.5")),
});

const results = async (...args: Parameters<typeof detect>) =>
  (await detect(...args)).selfTests.map((t) => t.result);

describe("self-test: every address counts", () => {
  test("one address that isn't the block answer fails it", async () => {
    expect(await results(redirectedIpv6)).toEqual(["redirected", "redirected"]);
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
    const [security, family] = fakeFilters;
    const quiet = [
      // Its server refuses this name.
      {
        ...security,
        canary: { answers: ["0.0.0.0"], name: "refused.example" },
      },
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

describe("self-test without a test name", () => {
  test("a filter with no documented test name isn't self-tested", async () => {
    const [security, family] = fakeFilters;
    const { canary: _, ...untested } = security as Filter;
    const n = await detect(redirectingTransport(), [
      untested,
      family,
    ] as Filter[]);
    expect(n.selfTests.map((t) => t.result)).toEqual([
      "untested",
      "redirected",
    ]);
    expect(redirectedFilters(n)).toEqual(["Family filter"]);
  });

  test("one redirected filter, when the others can't tell, isn't an intercepted network", async () => {
    const [security, family] = fakeFilters;
    const { canary: _, ...untested } = security as Filter;
    const n = await detect(redirectingTransport(), [
      untested,
      family,
    ] as Filter[]);
    expect(redirectedFilters(n)).toEqual(["Family filter"]);
    expect(seemsIntercepted(n)).toBe(false);
  });

  test("a block that isn't the filter's own doesn't pass", async () => {
    const [security, family] = fakeFilters;
    // The resolver the network uses answers 0.0.0.0, like the family filter;
    // the security filter's own block is a CNAME to its warning page.
    const ownBlocks = [
      {
        ...security,
        canary: { answers: ["148.123.15.44"], name: "canary.example" },
      },
      family,
    ] as Filter[];
    expect(await results(blockingRedirectTransport, ownBlocks)).toEqual([
      "redirected",
      "passed",
    ]);
  });
});
