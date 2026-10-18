/**
 * The nbchecker command on the fake network the tests use, so tests can run
 * it as a real process, with real pipes, without touching the network.
 * With NBCHECKER_FAKE_NETWORK=redirecting, the network sends every query to
 * an unfiltered resolver. With NBCHECKER_FAKE_QUERIES=1, each name asked
 * over the network, by any resolver, is written to standard error.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { env } from "bun";
import { Console, Effect, Layer } from "effect";
import { Dns } from "effect/net";
import { CheckerOptions } from "../check/checker.ts";
import { cli } from "../cli.ts";
import { DnsTransport } from "../dns/transport.ts";
import {
  computer,
  fakeFilters,
  fakeTransport,
  redirectingTransport,
} from "./fake-network.ts";
import { truthUrl } from "./run-check.ts";

const { NBCHECKER_FAKE_NETWORK: network, NBCHECKER_FAKE_QUERIES: logQueries } =
  env;

/** Notes a name as soon as it's asked, even if the query is then cut short. */
const asked = (name: string) => {
  if (logQueries === "1") {
    Effect.runSync(Console.error(`asked ${name}`));
  }
};

let transport = fakeTransport;
if (network === "redirecting") {
  transport = redirectingTransport();
}

const recordedTransport = Layer.effect(
  DnsTransport,
  Effect.gen(function* () {
    const t = yield* DnsTransport;
    return {
      ask: (server, name, type) => {
        asked(name);
        return t.ask(server, name, type);
      },
      doh: (url, name, type) => {
        asked(name);
        return t.doh(url, name, type);
      },
    } satisfies typeof t;
  })
).pipe(Layer.provide(transport));

const recordedComputer = Layer.effect(
  Dns.Dns,
  Effect.gen(function* () {
    const d = yield* Dns.Dns;
    return Dns.make({
      lookup: (name) => {
        asked(name);
        return d.lookup(name);
      },
    });
  })
).pipe(Layer.provide(computer));

cli.pipe(
  Effect.provideService(CheckerOptions, {
    filters: fakeFilters,
    truthUrls: [truthUrl],
  }),
  Effect.provide(
    Layer.mergeAll(BunServices.layer, recordedTransport, recordedComputer)
  ),
  BunRuntime.runMain
);
