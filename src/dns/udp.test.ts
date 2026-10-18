import { describe, expect, test } from "bun:test";
import { sleep, udpSocket } from "bun";
import { Effect, Fiber } from "effect";
import { replyTo } from "../testing/response.ts";
import { Rcode } from "./codes.ts";
import { type OpenUdp, sendUdp, type UdpOptions } from "./sockets.ts";
import { encodeQuery } from "./wire.ts";

const queryId = 7;
const refused = /refused/i;
/** The fakes ignore the port, and the bind test fails before using it. */
const dnsPort = 53;
const query = Effect.runSync(encodeQuery(queryId, "example.com", "A"));

/** A UDP socket that opens when the test says so and records its use. */
const fakeUdp = () => {
  const state = { closed: false, sent: 0 };
  let handlers: UdpOptions["socket"] | undefined;
  let open: (() => void) | undefined;
  const socket = {
    close: () => {
      state.closed = true;
    },
    send: () => {
      state.sent += 1;
      return true;
    },
  };
  const factory: OpenUdp = (options) => {
    handlers = options.socket;
    return new Promise((resolve) => {
      open = () => resolve(socket);
    });
  };
  const opened = async () => {
    open?.();
    await sleep(0);
  };
  const receive = (data: Uint8Array) => handlers?.data(socket, data);
  // Bun calls the error handler with the error alone.
  const error = (e: Error) => handlers?.error(e);
  return { error, factory, opened, receive, state };
};

const run = (open: OpenUdp) =>
  Effect.runFork(sendUdp("127.0.0.1", dnsPort, query, open));

describe("sendUdp", () => {
  test("an answer closes the socket", async () => {
    const udp = fakeUdp();
    const fiber = run(udp.factory);
    await udp.opened();
    const answer = replyTo(query);
    udp.receive(answer);
    expect(await Effect.runPromise(Fiber.join(fiber))).toEqual(answer);
    expect(udp.state).toEqual({ closed: true, sent: 1 });
  });

  test("an error closes the socket and says why", async () => {
    const udp = fakeUdp();
    const fiber = run(udp.factory);
    await udp.opened();
    udp.error(new Error("ECONNREFUSED: connection refused, recv"));
    const error = await Effect.runPromise(Effect.flip(Fiber.join(fiber)));
    expect(error.reason).toBe("ECONNREFUSED: connection refused, recv");
    expect(udp.state.closed).toBe(true);
  });

  test("a socket that opens after an interrupt is closed unused", async () => {
    const udp = fakeUdp();
    const fiber = run(udp.factory);
    await Effect.runPromise(Fiber.interrupt(fiber));
    await udp.opened();
    expect(udp.state).toEqual({ closed: true, sent: 0 });
  });

  test("an answer to another question is ignored", async () => {
    const udp = fakeUdp();
    const fiber = run(udp.factory);
    await udp.opened();
    const right = replyTo(query, { rcode: Rcode.nxDomain });
    udp.receive(replyTo(query, { question: "bad.example" }));
    udp.receive(right);
    expect(await Effect.runPromise(Fiber.join(fiber))).toEqual(right);
  });
});

describe("sendUdp failures", () => {
  const fails = (open: OpenUdp) =>
    Effect.runPromise(Effect.flip(Fiber.join(run(open))));

  test("a socket that can't be created is a query error", async () => {
    const error = await fails(() => {
      throw new Error("bind EPERM 0.0.0.0");
    });
    expect(error).toMatchObject({
      _tag: "QueryError",
      reason: "bind EPERM 0.0.0.0",
    });
  });

  test("a socket that fails to open is a query error", async () => {
    const error = await fails(() => Promise.reject(new Error("bind EPERM ::")));
    expect(error).toMatchObject({
      _tag: "QueryError",
      reason: "bind EPERM ::",
    });
  });

  test("a socket that Bun can't bind is a query error", async () => {
    // Binding to an address this computer doesn't have throws at once.
    const error = await fails((options) =>
      udpSocket({ ...options, hostname: "192.0.2.1" })
    );
    expect(error.reason).toContain("bind");
  });

  test("a refused query says why", async () => {
    // A port that was just free is very likely still closed.
    const probe = await udpSocket({ hostname: "127.0.0.1" });
    const { port } = probe;
    probe.close();
    const error = await Effect.runPromise(
      Effect.flip(sendUdp("127.0.0.1", port, query))
    );
    expect(error.reason).toMatch(refused);
  });
});
