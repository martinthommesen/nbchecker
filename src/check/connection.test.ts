import { expect, test } from "bun:test";
import { Effect } from "effect";
import { Dns } from "effect/net";
import { connectionText, detectConnection, testPage } from "./connection.ts";

const detect = (hosts: Record<string, readonly string[]>) =>
  detectConnection.pipe(
    Effect.provide(Dns.layerStatic({ hosts })),
    Effect.map(connectionText),
    Effect.runPromise
  );

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
  const failing = Dns.make({
    lookup: (hostname) =>
      Effect.fail(
        new Dns.DnsError({
          hostname,
          method: "lookup",
          reason: "ServerFailure",
        })
      ),
  });
  const text = await detectConnection.pipe(
    Effect.provideService(Dns.Dns, failing),
    Effect.map(connectionText),
    Effect.runPromise
  );
  expect(text).toBe("unknown");
});
