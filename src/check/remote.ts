/** Asks the filters and the unfiltered resolvers over the network. */
import { Effect } from "effect";
import { DnsTransport } from "../dns/transport.ts";
import { type DnsAnswer, Rcode } from "../dns/wire.ts";
import type { Filter } from "./filters.ts";

const isFailure = (a: DnsAnswer): boolean =>
  a.rcode !== Rcode.noError && a.rcode !== Rcode.nxDomain;

export interface FilterAnswer {
  readonly answers: readonly DnsAnswer[];
  readonly server: string;
}

export interface Truth extends FilterAnswer {
  readonly addresses: readonly string[];
  readonly exists: boolean;
}

/**
 * Sends A and AAAA queries to every server of a filter at once and keeps
 * the first server that answers both. An error rcode counts as no answer,
 * so the next server is used.
 */
export const askFilter = (filter: Filter, host: string) =>
  Effect.gen(function* () {
    const transport = yield* DnsTransport;
    const askServer = (server: string) =>
      Effect.all(
        [transport.ask(server, host, "A"), transport.ask(server, host, "AAAA")],
        { concurrency: "unbounded" }
      ).pipe(
        Effect.flatMap((answers) => {
          const failed = answers.find(isFailure);
          if (failed === undefined) {
            return Effect.succeed<FilterAnswer>({ answers, server });
          }
          return Effect.fail({
            message: `${server}: DNS error ${failed.rcode}`,
          });
        })
      );
    return yield* Effect.raceAll(filter.servers.map(askServer));
  });

/** Gets the real answer from the first DNS-over-HTTPS resolver that works. */
export const lookupTruth = (urls: readonly string[], host: string) =>
  Effect.gen(function* () {
    const transport = yield* DnsTransport;
    const askUrl = (url: string) =>
      Effect.all(
        [transport.doh(url, host, "A"), transport.doh(url, host, "AAAA")],
        { concurrency: "unbounded" }
      ).pipe(
        Effect.flatMap(([a, aaaa]) => {
          if (isFailure(a)) {
            return Effect.fail({ message: `${url}: DNS error ${a.rcode}` });
          }
          const addresses = [...a.records, ...aaaa.records]
            .filter((r) => r.type !== "CNAME")
            .map((r) => r.value);
          return Effect.succeed<Truth>({
            addresses,
            answers: [a, aaaa],
            exists: a.rcode !== Rcode.nxDomain,
            server: url,
          });
        })
      );
    if (urls.length === 0) {
      return yield* Effect.fail({
        message: "no unfiltered resolver configured",
      });
    }
    return yield* Effect.firstSuccessOf(urls.map(askUrl));
  });
