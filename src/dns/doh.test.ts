import { expect, test } from "bun:test";
import { serve } from "bun";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { replyTo } from "../testing/response.ts";
import { DnsTransport, layer } from "./transport.ts";

/** One byte more than a DNS message can be. */
const tooBig = 65_536;

/** Asks a local DoH server that replies with `reply(query)`. */
const askDoh = async (reply: (query: Uint8Array) => Uint8Array) => {
  const server = serve({
    fetch: async (request) =>
      new Response(reply(new Uint8Array(await request.arrayBuffer())), {
        headers: { "content-type": "application/dns-message" },
      }),
    hostname: "127.0.0.1",
    port: 0,
  });
  try {
    return await Effect.gen(function* () {
      const t = yield* DnsTransport;
      return yield* t.doh(
        `http://127.0.0.1:${server.port}/dns-query`,
        "example.com",
        "AAAA"
      );
    }).pipe(
      Effect.provide(Layer.provide(layer(), FetchHttpClient.layer)),
      Effect.flip,
      Effect.runPromise
    );
  } finally {
    await server.stop(true);
  }
};

test("doh rejects a truncated answer", async () => {
  const error = await askDoh((q) => replyTo(q, { truncated: true }));
  expect(error.reason).toBe("answer was truncated");
});

test("doh rejects an answer to another question", async () => {
  const error = await askDoh((q) => replyTo(q, { questionType: "A" }));
  expect(error.reason).toBe("bad answer: question doesn't match");
});

test("doh rejects an answer bigger than a DNS message", async () => {
  const error = await askDoh((q) => {
    const body = new Uint8Array(tooBig);
    body.set(replyTo(q));
    return body;
  });
  expect(error.reason).toBe("answer is too big");
});
