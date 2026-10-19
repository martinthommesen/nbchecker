import { afterAll, beforeAll, expect, test } from "bun:test";
import { listen, udpSocket } from "bun";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { replyTo } from "../testing/response.ts";
import { frame, unframe } from "./bytes.ts";
import { DnsTransport, layer } from "./transport.ts";

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
/** The TCP server says answers for this name are truncated too. */
const cutName = "cut.example";
const decoder = new TextDecoder();

// One port for both servers: a UDP server that says every answer is
// truncated, and a TCP server with the full answer, except for `cutName`.
let port = 0;
const closers: (() => void)[] = [];

beforeAll(async () => {
  const udp = await udpSocket({
    binaryType: "uint8array",
    hostname: "127.0.0.1",
    socket: {
      data: (socket, data, fromPort, fromAddress) => {
        socket.send(
          replyTo(data, { records: [answerRecord], truncated: true }),
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
        const query = unframe(data);
        if (query === undefined) {
          return;
        }
        const truncated = decoder.decode(query).includes("cut");
        socket.write(
          frame(replyTo(query, { records: [bigRecord], truncated }))
        );
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

/** Asks `server`, on the test servers' port, for `name`'s A records. */
const ask = (server: string, name: string) =>
  DnsTransport.use((t) => t.ask(server, name, "A")).pipe(
    Effect.provide(Layer.provide(layer(port), FetchHttpClient.layer))
  );

test("ask retries a truncated UDP answer over TCP", async () => {
  const answer = await Effect.runPromise(ask("127.0.0.1", "example.com"));
  expect(answer.records).toEqual([bigRecord]);
});

test("ask fails when the TCP answer is truncated too", async () => {
  const error = await Effect.runPromise(Effect.flip(ask("127.0.0.1", cutName)));
  expect(error.reason).toContain("truncated");
});

test("ask fails when nothing answers", async () => {
  const error = await Effect.runPromise(
    Effect.flip(ask("127.0.0.2", "example.com"))
  );
  expect(error.server).toBe("127.0.0.2");
});
