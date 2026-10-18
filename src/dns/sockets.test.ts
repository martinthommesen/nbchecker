import { describe, expect, test } from "bun:test";
import { connect, listen, sleep } from "bun";
import { Effect, Fiber } from "effect";
import { query, queryId, replyTo } from "../testing/response.ts";
import { frame, unframe } from "./bytes.ts";
import { type OpenTcp, sendTcp } from "./sockets.ts";

const waitMs = 500;

/** A loopback DNS server over TCP that says if the client hung up. */
const tcpServer = (reply: (query: Uint8Array) => Uint8Array) => {
  const seen = { queries: 0 };
  const { promise: hungUp, resolve } = Promise.withResolvers<boolean>();
  const server = listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      binaryType: "uint8array",
      close: () => resolve(true),
      data: (socket, data) => {
        seen.queries += 1;
        const asked = unframe(data);
        if (asked !== undefined) {
          socket.write(frame(reply(asked)));
        }
      },
    },
  });
  const closed = () => Promise.race([hungUp, sleep(waitMs).then(() => false)]);
  return { closed, port: server.port, seen, stop: () => server.stop(true) };
};

const askTcp = (port: number, open?: OpenTcp) =>
  Effect.flip(sendTcp("127.0.0.1", port, query, open)).pipe(Effect.runPromise);

describe("sendTcp", () => {
  test("an answer for a different query is rejected and hung up", async () => {
    const server = tcpServer((q) => replyTo(q, { id: queryId + 1 }));
    try {
      const error = await askTcp(server.port);
      expect(error.message).toContain("different query");
      expect(await server.closed()).toBe(true);
    } finally {
      server.stop();
    }
  });

  test("an answer to another question is rejected", async () => {
    const server = tcpServer((q) => replyTo(q, { question: "bad.example" }));
    try {
      const error = await askTcp(server.port);
      expect(error.reason).toBe("bad answer: question doesn't match");
      expect(await server.closed()).toBe(true);
    } finally {
      server.stop();
    }
  });

  test("a connection that opens after an interrupt sends nothing", async () => {
    const server = tcpServer((q) => replyTo(q));
    try {
      const { promise: called, resolve } = Promise.withResolvers<void>();
      const open: OpenTcp = (options) => {
        const opening = connect(options);
        resolve();
        return opening;
      };
      const fiber = Effect.runFork(
        sendTcp("127.0.0.1", server.port, query, open)
      );
      await called;
      await Effect.runPromise(Fiber.interrupt(fiber));
      expect(await server.closed()).toBe(true);
      expect(server.seen.queries).toBe(0);
    } finally {
      server.stop();
    }
  });

  test("a socket that can't be created is a query error", async () => {
    const open: OpenTcp = () => {
      throw new Error("connect EPERM 127.0.0.1:53");
    };
    const error = await askTcp(1, open);
    expect(error).toMatchObject({
      _tag: "QueryError",
      reason: "connect EPERM 127.0.0.1:53",
    });
  });
});
