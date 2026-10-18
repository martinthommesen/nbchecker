/** Runs a whole check against the fake network, for tests across layers. */
import { Effect, type Layer } from "effect";
import type { Dns } from "effect/net";
import { CheckerOptions, check } from "../check/checker.ts";
import { detectNetwork } from "../check/network.ts";
import type { CheckResult } from "../check/result.ts";
import type { DnsTransport } from "../dns/transport.ts";
import { computer, fakeFilters, fakeTransport } from "./fake-network.ts";

export const truthUrl = "https://truth.example/dns-query";
export const downTruthUrl = "https://down.example/dns-query";

export interface RunOptions extends Partial<CheckerOptions> {
  /** This computer's resolver; the fake network's by default. */
  readonly dns?: Layer.Layer<Dns.Dns, unknown>;
  /** How DNS queries are sent; the fake network's by default. */
  readonly transport?: Layer.Layer<DnsTransport>;
}

/** Checks a target, detecting the network first as a run does. */
export const runCheck = (
  target: string,
  { dns = computer, transport = fakeTransport, ...options }: RunOptions = {}
): Promise<CheckResult> =>
  check(target, detectNetwork).pipe(
    Effect.provideService(CheckerOptions, {
      filters: fakeFilters,
      truthUrls: [truthUrl],
      ...options,
    }),
    Effect.provide(transport),
    Effect.provide(dns),
    Effect.orDie,
    Effect.runPromise
  );
