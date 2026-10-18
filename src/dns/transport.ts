/**
 * Sends DNS queries: plain DNS to a filter's servers, and DNS-over-HTTPS for
 * the real answer.
 */
import { Context, Effect, Layer, Stream } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";
import { concat } from "./bytes.ts";
import type { MalformedMessage } from "./malformed.ts";
import { mismatch } from "./match.ts";
import { QueryError, timeoutAfter } from "./query-error.ts";
import { sendTcp, sendUdp } from "./sockets.ts";
import {
  type DnsAnswer,
  decodeResponse,
  encodeQuery,
  type QueryType,
} from "./wire.ts";

const dnsPort = 53;
const dnsMessage = "application/dns-message";
/** The largest DNS message, and so the largest DoH body (RFC 8484). */
const maxMessageBytes = 65_535;

/** Sends a query message to a server and returns the reply to it. */
type Send = (
  server: string,
  port: number,
  packet: Uint8Array
) => Effect.Effect<Uint8Array, QueryError>;

/** A random 16-bit ID; unpredictable IDs make forged answers harder. */
const randomId = (): number => {
  const [id = 0] = globalThis.crypto.getRandomValues(new Uint16Array(1));
  return id;
};

/** A message that can't be encoded or decoded fails the query to `server`. */
const asQueryError = (server: string) =>
  Effect.mapError(
    (error: MalformedMessage) =>
      new QueryError({ reason: error.reason, server })
  );

const failed =
  (server: string) =>
  (error: { readonly message: string }): QueryError =>
    new QueryError({ reason: error.message, server });

/** Fails with `reason` when only part of the answer came back. */
const rejectTruncated =
  (server: string, reason: string) =>
  (answer: DnsAnswer): Effect.Effect<DnsAnswer, QueryError> => {
    if (answer.truncated) {
      return Effect.fail(new QueryError({ reason, server }));
    }
    return Effect.succeed(answer);
  };

/** Reads a DoH body, giving up as soon as it is bigger than a DNS message. */
const readBody = (
  response: HttpClientResponse.HttpClientResponse,
  url: string
): Effect.Effect<Uint8Array, QueryError> =>
  response.stream.pipe(
    Stream.mapError(failed(url)),
    Stream.runFoldEffect(
      (): Uint8Array => new Uint8Array(0),
      (body, chunk): Effect.Effect<Uint8Array, QueryError> => {
        if (body.length + chunk.length > maxMessageBytes) {
          return Effect.fail(
            new QueryError({ reason: "answer is too big", server: url })
          );
        }
        return Effect.succeed(concat([body, chunk]));
      }
    )
  );

/** Posts a query to a DoH endpoint and reads the reply. */
const post = (
  client: HttpClient.HttpClient,
  url: string,
  packet: Uint8Array
) => {
  const request = HttpClientRequest.post(url).pipe(
    HttpClientRequest.setHeader("accept", dnsMessage),
    HttpClientRequest.bodyUint8Array(packet, dnsMessage)
  );
  return client.execute(request).pipe(
    Effect.mapError(failed(url)),
    Effect.flatMap((response) => readBody(response, url))
  );
};

/** Sends a query one way, UDP or TCP, and decodes the reply. */
const exchange = (
  send: Send,
  server: string,
  port: number,
  packet: Uint8Array
) =>
  send(server, port, packet).pipe(
    Effect.flatMap((reply) => decodeResponse(reply).pipe(asQueryError(server)))
  );

const ask = (port: number) => (server: string, name: string, type: QueryType) =>
  Effect.gen(function* () {
    const packet = yield* encodeQuery(randomId(), name, type).pipe(
      asQueryError(server)
    );
    const answer = yield* exchange(sendUdp, server, port, packet);
    if (!answer.truncated) {
      return answer;
    }
    // Classifying part of an answer could miss a block.
    return yield* exchange(sendTcp, server, port, packet).pipe(
      Effect.flatMap(
        rejectTruncated(server, "answer was truncated over TCP too")
      )
    );
  }).pipe(timeoutAfter("2 seconds", server));

const doh =
  (client: HttpClient.HttpClient) =>
  (url: string, name: string, type: QueryType) =>
    Effect.gen(function* () {
      const packet = yield* encodeQuery(0, name, type).pipe(asQueryError(url));
      const body = yield* post(client, url, packet);
      const problem = mismatch(packet, body);
      if (problem !== undefined) {
        return yield* Effect.fail(
          new QueryError({ reason: problem, server: url })
        );
      }
      // A partial reference answer could make a filter look like it blocks.
      return yield* decodeResponse(body).pipe(
        asQueryError(url),
        Effect.flatMap(rejectTruncated(url, "answer was truncated"))
      );
    }).pipe(timeoutAfter("5 seconds", url));

export interface DnsTransportShape {
  /** Asks one DNS server over UDP, retrying over TCP when truncated. */
  readonly ask: (
    server: string,
    name: string,
    type: QueryType
  ) => Effect.Effect<DnsAnswer, QueryError>;
  /** Asks a DNS-over-HTTPS endpoint. */
  readonly doh: (
    url: string,
    name: string,
    type: QueryType
  ) => Effect.Effect<DnsAnswer, QueryError>;
}

export class DnsTransport extends Context.Service<
  DnsTransport,
  DnsTransportShape
>()("nbchecker/DnsTransport") {}

/** The real transport. Tests pass another `port`. */
export const layer = (
  port = dnsPort
): Layer.Layer<DnsTransport, never, HttpClient.HttpClient> =>
  Layer.effect(
    DnsTransport,
    Effect.gen(function* () {
      const client = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
      return { ask: ask(port), doh: doh(client) };
    })
  );
