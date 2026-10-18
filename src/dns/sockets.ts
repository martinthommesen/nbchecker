/** Sends one DNS message over UDP or TCP with Bun's sockets. */
import { connect, udpSocket } from "bun";
import { Effect } from "effect";
import { NetAddress } from "effect/net";
import { QueryError } from "./query-error.ts";
import { responseId } from "./wire.ts";

const lengthPrefixBytes = 2;

const bindAddress = (server: string): string => {
  const ip = NetAddress.ipFromString(server);
  if (ip._tag === "Success" && NetAddress.familyOf(ip.success) === "IPv6") {
    return "::";
  }
  return "0.0.0.0";
};

const errorText = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

/** Prefixes a message with its length, as DNS over TCP needs. */
const frame = (packet: Uint8Array): Uint8Array => {
  const out = new Uint8Array(packet.length + lengthPrefixBytes);
  new DataView(out.buffer).setUint16(0, packet.length);
  out.set(packet, lengthPrefixBytes);
  return out;
};

const append = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

/** Returns the framed message once all of it has arrived. */
const unframe = (received: Uint8Array): Uint8Array | undefined => {
  if (received.length < lengthPrefixBytes) {
    return;
  }
  const want = new DataView(received.buffer, received.byteOffset).getUint16(0);
  if (received.length < want + lengthPrefixBytes) {
    return;
  }
  return received.subarray(lengthPrefixBytes, want + lengthPrefixBytes);
};

/** Sends a query over UDP and waits for the answer with the same ID. */
export const sendUdp = (
  server: string,
  port: number,
  packet: Uint8Array
): Effect.Effect<Uint8Array, QueryError> =>
  Effect.callback<Uint8Array, QueryError>((resume) => {
    let close: (() => void) | undefined;
    const id = responseId(packet);
    const fail = (error: unknown): void =>
      resume(Effect.fail(new QueryError({ reason: errorText(error), server })));
    udpSocket({
      binaryType: "uint8array",
      connect: { hostname: server, port },
      hostname: bindAddress(server),
      socket: {
        data: (_socket, data) => {
          if (responseId(data) === id) {
            resume(Effect.succeed(data));
          }
        },
        error: (_socket, error) => fail(error),
      },
    }).then((socket) => {
      close = () => socket.close();
      socket.send(packet);
    }, fail);
    return Effect.sync(() => close?.());
  });

/** Sends a query over TCP, for answers too big for UDP. */
export const sendTcp = (
  server: string,
  port: number,
  packet: Uint8Array
): Effect.Effect<Uint8Array, QueryError> =>
  Effect.callback<Uint8Array, QueryError>((resume) => {
    let close: (() => void) | undefined;
    let received: Uint8Array = new Uint8Array(0);
    const id = responseId(packet);
    const fail = (error: unknown): void =>
      resume(Effect.fail(new QueryError({ reason: errorText(error), server })));
    connect({
      hostname: server,
      port,
      socket: {
        binaryType: "uint8array",
        close: () => fail("connection closed before the answer"),
        connectError: (_socket, error) => fail(error),
        data: (_socket, chunk) => {
          received = append(received, chunk);
          const message = unframe(received);
          if (message === undefined) {
            return;
          }
          if (responseId(message) === id) {
            resume(Effect.succeed(message));
          } else {
            fail("answer was for a different query");
          }
        },
        error: (_socket, error) => fail(error),
        open: (socket) => {
          socket.write(frame(packet));
        },
      },
    }).then((socket) => {
      close = () => socket.end();
    }, fail);
    return Effect.sync(() => close?.());
  });
