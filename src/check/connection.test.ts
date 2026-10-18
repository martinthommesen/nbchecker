import { expect, test } from "bun:test";
import { Effect, type Layer } from "effect";
import { Dns } from "effect/net";
import { failingComputer } from "../testing/fake-network.ts";
import { connectionText, detectConnection } from "./connection.ts";
import { telenorTestPage } from "./known-answers.ts";

const testPage = telenorTestPage.name;

const detectWith = (computer: Layer.Layer<Dns.Dns, unknown>) =>
  detectConnection.pipe(
    Effect.provide(computer),
    Effect.map(connectionText),
    Effect.runPromise
  );

const detect = (hosts: Record<string, readonly string[]>) =>
  detectWith(Dns.layerStatic({ hosts }));

test("reads which filter Telenor's test page answers for", async () => {
  expect(await detect({ [testPage]: ["148.123.15.1"] })).toBe(
    "Telenor Nettvern+"
  );
  expect(await detect({ [testPage]: ["148.123.15.38"] })).toBe(
    "Telenor Nettvern"
  );
});

test("the public answer to the test page doesn't mean Telenor's DNS", async () => {
  // Every unfiltered resolver, Google's and Cloudflare's too, gets this one.
  expect(await detect({ [testPage]: ["148.123.15.37"] })).toBe("none detected");
});

test("reports no filter when the test page answers anything else", async () => {
  expect(await detect({ [testPage]: ["192.0.2.1"] })).toBe("none detected");
  expect(await detect({})).toBe("none detected");
});

test("reports unknown when the lookup fails", async () => {
  expect(await detectWith(failingComputer)).toBe("unknown");
});
