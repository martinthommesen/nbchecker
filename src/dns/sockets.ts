/** Sends one DNS message over UDP or TCP with Bun's sockets. */
import { connect, udpSocket } from "bun";
import { Effect } from "effect";
import { NetAddress } from "effect/net";
import { concat, frame, unframe } from "./bytes.ts";
import { mismatch } from "./match.ts";
import { QueryError } from "./query-error.ts";

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

type Resume = (result: Effect.Effect<Uint8Array, QueryError>) => void;

interface Query<S> {
  /** Keeps a socket that opened, or closes it if the query is over. */
  readonly adopt: (socket: S) => boolean;
  readonly done: () => boolean;
  readonly fail: (error: unknown) => void;
  /** What `Effect.callback` runs on interruption. */
  readonly interrupt: Effect.Effect<void>;
  readonly succeed: (answer: Uint8Array) => void;
}

/**
 * Settles a query once and closes its socket however it ends: an answer, an
 * error, or an interruption, even one that comes before the socket opens.
 * Closing can call the socket's handlers at once; they find the query done.
 */
const settle = <S>(
  resume: Resume,
  server: string,
  close: (socket: S) => void
): Query<S> => {
  let done = false;
  let socket: S | undefined;
  const release = (): void => {
    const s = socket;
    socket = undefined;
    if (s !== undefined) {
      close(s);
    }
  };
  const finish = (result: Effect.Effect<Uint8Array, QueryError>): void => {
    if (done) {
      return;
    }
    done = true;
    resume(result);
    release();
  };
  return {
    adopt: (s) => {
      if (done) {
        close(s);
        return false;
      }
      socket = s;
      return true;
    },
    done: () => done,
    fail: (error) =>
      finish(Effect.fail(new QueryError({ reason: errorText(error), server }))),
    interrupt: Effect.sync(() => {
      done = true;
      release();
    }),
    succeed: (answer) => finish(Effect.succeed(answer)),
  };
};

const openUdp: OpenUdp = (options) => udpSocket(options);
const openTcp: OpenTcp = (options) => connect(options);

/** The parts of a connected Bun UDP socket a query uses. */
export interface UdpSocket {
  readonly close: () => void;
  readonly send: (data: Uint8Array) => boolean;
}

export interface UdpOptions {
  readonly binaryType: "uint8array";
  readonly connect: { readonly hostname: string; readonly port: number };
  readonly hostname: string;
  readonly socket: {
    readonly data: (socket: UdpSocket, data: Uint8Array) => void;
    readonly error: (...args: readonly unknown[]) => void;
  };
}

/** Opens a connected UDP socket. Tests pass a fake. */
export type OpenUdp = (options: UdpOptions) => Promise<UdpSocket>;

/** The parts of a Bun TCP socket a query uses. */
export interface TcpSocket {
  readonly end: () => void;
  readonly write: (data: Uint8Array) => number;
}

export interface TcpOptions {
  readonly hostname: string;
  readonly port: number;
  readonly socket: {
    readonly binaryType: "uint8array";
    readonly close: () => void;
    readonly connectError: (...args: readonly unknown[]) => void;
    readonly data: (socket: TcpSocket, chunk: Uint8Array) => void;
    readonly error: (...args: readonly unknown[]) => void;
    readonly open: (socket: TcpSocket) => void;
  };
}

/** Opens a TCP connection. Tests pass a fake. */
export type OpenTcp = (options: TcpOptions) => Promise<unknown>;

/**
 * Sends a query over UDP and waits for its answer. Other datagrams are
 * ignored, since the real answer may still come before the deadline.
 */
export const sendUdp = (
  server: string,
  port: number,
  packet: Uint8Array,
  open: OpenUdp = openUdp
): Effect.Effect<Uint8Array, QueryError> =>
  Effect.callback<Uint8Array, QueryError>((resume) => {
    const query = settle<UdpSocket>(resume, server, (s) => s.close());
    const options: UdpOptions = {
      binaryType: "uint8array",
      connect: { hostname: server, port },
      hostname: bindAddress(server),
      socket: {
        data: (_socket, data) => {
          if (mismatch(packet, data) === undefined) {
            query.succeed(data);
          }
        },
        // Bun passes the error alone, not (socket, error) as its types say.
        error: (...args) => query.fail(args.at(-1)),
      },
    };
    try {
      open(options)
        .then((socket) => {
          if (query.adopt(socket)) {
            socket.send(packet);
          }
        })
        .catch(query.fail);
    } catch (error) {
      // Creating or binding the socket throws, e.g. where network is denied.
      query.fail(error);
    }
    return query.interrupt;
  });

/** Sends a query over TCP, for answers too big for UDP. */
export const sendTcp = (
  server: string,
  port: number,
  packet: Uint8Array,
  open: OpenTcp = openTcp
): Effect.Effect<Uint8Array, QueryError> =>
  Effect.callback<Uint8Array, QueryError>((resume) => {
    const query = settle<TcpSocket>(resume, server, (s) => s.end());
    let received: Uint8Array = new Uint8Array(0);
    const onData = (chunk: Uint8Array): void => {
      if (query.done()) {
        return;
      }
      received = concat([received, chunk]);
      const message = unframe(received);
      if (message === undefined) {
        return;
      }
      const problem = mismatch(packet, message);
      if (problem === undefined) {
        query.succeed(message);
      } else {
        query.fail(problem);
      }
    };
    const options: TcpOptions = {
      hostname: server,
      port,
      socket: {
        binaryType: "uint8array",
        close: () => query.fail("connection closed before the answer"),
        connectError: (...args) => query.fail(args.at(-1)),
        data: (_socket, chunk) => onData(chunk),
        error: (...args) => query.fail(args.at(-1)),
        open: (socket) => {
          if (query.adopt(socket)) {
            socket.write(frame(packet));
          }
        },
      },
    };
    try {
      open(options).catch(query.fail);
    } catch (error) {
      query.fail(error);
    }
    return query.interrupt;
  });
