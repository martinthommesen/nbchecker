/** Runs a whole check against the fake network, for tests across layers. */
import { Effect, type Layer } from "effect";
import type { Dns } from "effect/net";
import { CheckerOptions, check } from "../check/checker.ts";
import type { CheckResult } from "../check/result.ts";
import { computer, fakeFilters, fakeTransport } from "./fake-network.ts";

export const truthUrl = "https://truth.example/dns-query";
export const downTruthUrl = "https://down.example/dns-query";

export interface RunOptions extends Partial<CheckerOptions> {
  /** This computer's resolver; the fake network's by default. */
  readonly dns?: Layer.Layer<Dns.Dns, unknown>;
}

export const runCheck = (
  target: string,
  { dns = computer, ...options }: RunOptions = {}
): Promise<CheckResult> =>
  check(target).pipe(
    Effect.provideService(CheckerOptions, {
      filters: fakeFilters,
      truthUrls: [truthUrl],
      ...options,
    }),
    Effect.provide(fakeTransport),
    Effect.provide(dns),
    Effect.orDie,
    Effect.runPromise
  );
