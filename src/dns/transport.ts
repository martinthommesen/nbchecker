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
import type { MalformedResponse } from "./malformed.ts";
import { mismatch } from "./match.ts";
import { QueryError } from "./query-error.ts";
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

/** A random 16-bit ID; unpredictable IDs make forged answers harder. */
const randomId = (): number => {
  const [id = 0] = globalThis.crypto.getRandomValues(new Uint16Array(1));
  return id;
};

const malformed = (server: string) => (error: MalformedResponse) =>
  new QueryError({ reason: error.reason, server });

const failed =
  (server: string) =>
  (error: { readonly message: string }): QueryError =>
    new QueryError({ reason: error.message, server });

const timedOut = (server: string) => () =>
  Effect.fail(new QueryError({ reason: "no answer (timed out)", server }));

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

const ask = (port: number) => (server: string, name: string, type: QueryType) =>
  Effect.gen(function* () {
    const packet = yield* encodeQuery(randomId(), name, type).pipe(
      Effect.mapError(malformed(server))
    );
    const answer = yield* sendUdp(server, port, packet).pipe(
      Effect.flatMap(decodeResponse),
      Effect.mapError((e) => {
        if (e._tag === "MalformedResponse") {
          return malformed(server)(e);
        }
        return e;
      })
    );
    if (!answer.truncated) {
      return answer;
    }
    const full = yield* sendTcp(server, port, packet).pipe(
      Effect.flatMap(decodeResponse),
      Effect.mapError((e) => {
        if (e._tag === "MalformedResponse") {
          return malformed(server)(e);
        }
        return e;
      })
    );
    if (full.truncated) {
      // Classifying part of an answer could miss a block.
      return yield* Effect.fail(
        new QueryError({ reason: "answer was truncated over TCP too", server })
      );
    }
    return full;
  }).pipe(
    Effect.timeoutOrElse({ duration: "2 seconds", orElse: timedOut(server) })
  );

const doh =
  (client: HttpClient.HttpClient) =>
  (url: string, name: string, type: QueryType) =>
    Effect.gen(function* () {
      const packet = yield* encodeQuery(0, name, type).pipe(
        Effect.mapError(malformed(url))
      );
      const request = HttpClientRequest.post(url).pipe(
        HttpClientRequest.setHeader("accept", dnsMessage),
        HttpClientRequest.bodyUint8Array(packet, dnsMessage)
      );
      const response = yield* client
        .execute(request)
        .pipe(Effect.mapError(failed(url)));
      const body = yield* readBody(response, url);
      const problem = mismatch(packet, body);
      if (problem !== undefined) {
        return yield* Effect.fail(
          new QueryError({ reason: problem, server: url })
        );
      }
      const answer = yield* decodeResponse(body).pipe(
        Effect.mapError(malformed(url))
      );
      if (answer.truncated) {
        // A partial reference answer could make a filter look like it blocks.
        return yield* Effect.fail(
          new QueryError({ reason: "answer was truncated", server: url })
        );
      }
      return answer;
    }).pipe(
      Effect.timeoutOrElse({ duration: "5 seconds", orElse: timedOut(url) })
    );

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
