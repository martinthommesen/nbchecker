/** Runs a whole check against the fake network, for tests across layers. */
import { Effect, type Layer } from "effect";
import type { Dns } from "effect/net";
import { check } from "../check/checker.ts";
import { detectNetwork } from "../check/network.ts";
import { CheckerOptions } from "../check/options.ts";
import { Progress } from "../check/progress.ts";
import type { CheckResult } from "../check/result.ts";
import type { DnsTransport } from "../dns/transport.ts";
import { computer, fakeOptions, fakeTransport } from "./fake-network.ts";

export interface RunOptions extends Partial<CheckerOptions> {
  /** This computer's resolver; the fake network's by default. */
  readonly dns?: Layer.Layer<Dns.Dns, unknown>;
  /** How DNS queries are sent; the fake network's by default. */
  readonly transport?: Layer.Layer<DnsTransport>;
}

/**
 * The real check of a target on the fake network, detecting the network
 * first as a run does. Left as an effect for tests that move the clock; the
 * others use `runCheck`.
 */
export const checkOnFakeNetwork = (
  target: string,
  { dns = computer, transport = fakeTransport, ...options }: RunOptions = {}
) =>
  check(target, detectNetwork).pipe(
    Effect.provideService(CheckerOptions, { ...fakeOptions, ...options }),
    Effect.provide(transport),
    Effect.provide(dns),
    Effect.orDie
  );

/** Checks a target on the fake network, and gives its result. */
export const runCheck = (
  target: string,
  options?: RunOptions
): Promise<CheckResult> =>
  Effect.runPromise(checkOnFakeNetwork(target, options));

/** Checks a target, keeping each result reported on the way, as a screen. */
export const progressOf = async (target: string, options?: RunOptions) => {
  const reports: CheckResult[] = [];
  const result = await checkOnFakeNetwork(target, options).pipe(
    Effect.provideService(Progress, (sofar) =>
      Effect.sync(() => {
        reports.push(sofar);
      })
    ),
    Effect.runPromise
  );
  return { reports, result };
};
