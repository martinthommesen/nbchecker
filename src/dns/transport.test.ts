import { afterAll, beforeAll, expect, test } from "bun:test";
import { listen, serve, udpSocket } from "bun";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { response } from "../testing/response.ts";
import { DnsTransport, layer } from "./transport.ts";
import { responseId } from "./wire.ts";

const answerRecord = {
  name: "example.com",
  type: "A",
  value: "192.0.2.1",
} as const;
const bigRecord = {
  name: "example.com",
  type: "A",
  value: "192.0.2.2",
} as const;
const lengthPrefix = 2;

// One port for both servers: a UDP server that says every answer is
// truncated, and a TCP server with the full answer.
let port = 0;
const closers: (() => void)[] = [];

beforeAll(async () => {
  const udp = await udpSocket({
    binaryType: "uint8array",
    hostname: "127.0.0.1",
    socket: {
      data: (socket, data, fromPort, fromAddress) => {
        const id = responseId(data) ?? 0;
        socket.send(
          response({ id, records: [answerRecord], truncated: true }),
          fromPort,
          fromAddress
        );
      },
    },
  });
  ({ port } = udp);
  closers.push(() => udp.close());
  const tcp = listen({
    hostname: "127.0.0.1",
    port,
    socket: {
      binaryType: "uint8array",
      data: (socket, data) => {
        const id = responseId(data.subarray(lengthPrefix)) ?? 0;
        const body = response({ id, records: [bigRecord] });
        const framed = new Uint8Array(body.length + lengthPrefix);
        new DataView(framed.buffer).setUint16(0, body.length);
        framed.set(body, lengthPrefix);
        socket.write(framed);
      },
    },
  });
  closers.push(() => tcp.stop(true));
});

afterAll(() => {
  for (const close of closers) {
    close();
  }
});

const transport = () => Layer.provide(layer(port), FetchHttpClient.layer);

test("ask retries a truncated UDP answer over TCP", async () => {
  const answer = await Effect.gen(function* () {
    const t = yield* DnsTransport;
    return yield* t.ask("127.0.0.1", "example.com", "A");
  }).pipe(Effect.provide(transport()), Effect.runPromise);
  expect(answer.records).toEqual([bigRecord]);
});

test("ask fails when nothing answers", async () => {
  const error = await Effect.gen(function* () {
    const t = yield* DnsTransport;
    return yield* t.ask("127.0.0.2", "example.com", "A");
  }).pipe(Effect.provide(transport()), Effect.flip, Effect.runPromise);
  expect(error.server).toBe("127.0.0.2");
});

test("doh posts a DNS message and decodes the answer", async () => {
  const server = serve({
    fetch: async (request) => {
      const query = new Uint8Array(await request.arrayBuffer());
      const body = response({
        id: responseId(query) ?? 0,
        records: [answerRecord],
      });
      return new Response(body, {
        headers: { "content-type": "application/dns-message" },
      });
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  try {
    const answer = await Effect.gen(function* () {
      const t = yield* DnsTransport;
      return yield* t.doh(
        `http://127.0.0.1:${server.port}/dns-query`,
        "example.com",
        "A"
      );
    }).pipe(Effect.provide(transport()), Effect.runPromise);
    expect(answer.records).toEqual([answerRecord]);
  } finally {
    await server.stop(true);
  }
});
