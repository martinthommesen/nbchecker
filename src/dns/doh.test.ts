import { expect, test } from "bun:test";
import { serve } from "bun";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { replyTo } from "../testing/response.ts";
import { DnsTransport, layer } from "./transport.ts";

/** One byte more than a DNS message can be. */
const tooBig = 65_536;
const answerRecord = {
  name: "example.com",
  type: "AAAA",
  value: "2001:db8::1",
} as const;

/** A local DoH server that replies with `reply(query)` while in scope. */
const dohServer = (reply: (query: Uint8Array) => Uint8Array) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      serve({
        fetch: async (request) =>
          new Response(reply(new Uint8Array(await request.arrayBuffer())), {
            headers: { "content-type": "application/dns-message" },
          }),
        hostname: "127.0.0.1",
        port: 0,
      })
    ),
    (server) => Effect.promise(() => server.stop(true))
  );

/** Asks a local DoH server, which replies with `reply(query)`, for AAAA. */
const askDoh = (reply: (query: Uint8Array) => Uint8Array) =>
  Effect.gen(function* () {
    const { port } = yield* dohServer(reply);
    const url = `http://127.0.0.1:${port}/dns-query`;
    return yield* DnsTransport.use((t) => t.doh(url, "example.com", "AAAA"));
  }).pipe(
    Effect.scoped,
    Effect.provide(Layer.provide(layer(), FetchHttpClient.layer))
  );

/** Why the answer `reply` makes is rejected. */
const rejection = (reply: (query: Uint8Array) => Uint8Array) =>
  Effect.runPromise(Effect.flip(askDoh(reply)));

test("doh posts a DNS message and decodes the answer", async () => {
  const answer = await Effect.runPromise(
    askDoh((q) => replyTo(q, { records: [answerRecord] }))
  );
  expect(answer.records).toEqual([answerRecord]);
});

test("doh rejects a truncated answer", async () => {
  const error = await rejection((q) => replyTo(q, { truncated: true }));
  expect(error.reason).toBe("answer was truncated");
});

test("doh rejects an answer to another question", async () => {
  const error = await rejection((q) => replyTo(q, { questionType: "A" }));
  expect(error.reason).toBe("bad answer: question doesn't match");
});

test("doh rejects an answer bigger than a DNS message", async () => {
  const error = await rejection((q) => {
    const body = new Uint8Array(tooBig);
    body.set(replyTo(q));
    return body;
  });
  expect(error.reason).toBe("answer is too big");
});
