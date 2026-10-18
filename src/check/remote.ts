/** Asks the filters and the unfiltered resolvers over the network. */
import { Effect } from "effect";
import { Rcode, rcodeName } from "../dns/codes.ts";
import { QueryError } from "../dns/query-error.ts";
import { DnsTransport } from "../dns/transport.ts";
import type { DnsAnswer, QueryType } from "../dns/wire.ts";
import { addressesIn } from "./address.ts";
import { hasBlockingError, type Reference } from "./classify.ts";
import type { Filter } from "./filters.ts";

const isFailure = (a: DnsAnswer): boolean =>
  a.rcode !== Rcode.noError && a.rcode !== Rcode.nxDomain;

/** Says which server failed and how, such as "192.0.2.1: REFUSED". */
const failure = (server: string, a: DnsAnswer) =>
  new QueryError({ reason: rcodeName(a.rcode), server });

/**
 * Asks one resolver for a name's A and AAAA records at once. The answers
 * come back A first, the order their addresses are listed in.
 */
const askBoth = <E>(ask: (type: QueryType) => Effect.Effect<DnsAnswer, E>) =>
  Effect.all([ask("A"), ask("AAAA")], { concurrency: "unbounded" });

/** What the server that answered said, and which server it was. */
export interface ServerAnswer {
  readonly answers: readonly DnsAnswer[];
  readonly server: string;
}

/**
 * Sends A and AAAA queries to every server of a filter at once and keeps
 * the first server that answers both. An error rcode counts as no answer,
 * so the next server is used, unless an Extended DNS Error says the name
 * was blocked: a SERVFAIL or REFUSED can carry one.
 */
export const askFilter = (filter: Filter, host: string) =>
  Effect.gen(function* () {
    const transport = yield* DnsTransport;
    const askServer = (server: string) =>
      askBoth((type) => transport.ask(server, host, type)).pipe(
        Effect.flatMap((answers) => {
          const failed = answers.find(isFailure);
          if (failed === undefined || answers.some(hasBlockingError)) {
            return Effect.succeed<ServerAnswer>({ answers, server });
          }
          return Effect.fail(failure(server, failed));
        })
      );
    return yield* Effect.raceAll(filter.servers.map(askServer));
  });

/** Gets the real answer from the first DNS-over-HTTPS resolver that works. */
export const askUnfiltered = (urls: readonly string[], host: string) =>
  Effect.gen(function* () {
    const transport = yield* DnsTransport;
    const askUrl = (url: string) =>
      askBoth((type) => transport.doh(url, host, type)).pipe(
        Effect.flatMap(([a, aaaa]) => {
          const failed = [a, aaaa].find(isFailure);
          if (failed !== undefined) {
            return Effect.fail(failure(url, failed));
          }
          return Effect.succeed<ServerAnswer & Reference>({
            addresses: addressesIn([a, aaaa]),
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
