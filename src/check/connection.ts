/** Works out which filter, if any, this computer's own DNS goes through. */
import { type Cause, Effect, Result } from "effect";
import { Dns, NetAddress } from "effect/net";
import { telenorTestPage } from "./known-answers.ts";

/** Which of Telenor's filters gives this answer to its test page, if any. */
const detectedBy = (ip: string): Detected | undefined => {
  const filter = telenorTestPage.answers.find((a) => a.ip === ip)?.filter;
  if (filter === undefined) {
    return;
  }
  return { filter, network: telenorTestPage.network };
};

interface Detected {
  readonly filter: string | undefined;
  /** The network the filter belongs to; only known along with the filter. */
  readonly network: string | undefined;
}

/** What detection says before it has found anything. */
const nothingDetected: Connection = {
  error: undefined,
  filter: undefined,
  network: undefined,
  testAnswers: [],
};

/**
 * Why the test lookup failed. Undefined when the resolver says the test page
 * doesn't exist: that is an answer, and none of Telenor's filters gives it.
 */
const lookupError = (
  failure: Cause.TimeoutError | Dns.DnsError
): string | undefined => {
  if (failure._tag === "DnsError" && failure.reason === "NotFound") {
    return;
  }
  return String(failure.message);
};

/** What the text output says for each state; a detected filter by name. */
const stateText: Record<ConnectionState, (c: Connection) => string> = {
  detected: (c) => c.filter ?? "",
  none: () => "none detected",
  unknown: () => "unknown",
};

export interface Connection extends Detected {
  /** Why the test lookup failed, if it did. */
  readonly error: string | undefined;
  /** The addresses this computer got for the test page. */
  readonly testAnswers: readonly string[];
}

/**
 * What detection found: a filter, no filter, or, when the test lookup
 * failed, nothing either way.
 */
export type ConnectionState = "detected" | "none" | "unknown";

/**
 * Looks up the test page through this computer's resolver. Only Telenor
 * publishes such a page so far, so other filters are not detected.
 */
export const detectConnection = Effect.gen(function* () {
  const dns = yield* Dns.Dns;
  const addresses = yield* dns
    .lookup(telenorTestPage.name)
    .pipe(Effect.timeout("5 seconds"), Effect.result);
  if (Result.isFailure(addresses)) {
    return { ...nothingDetected, error: lookupError(addresses.failure) };
  }
  const testAnswers = addresses.success.map(NetAddress.formatIp);
  const detected = testAnswers.map(detectedBy).find((d) => d !== undefined);
  return {
    ...nothingDetected,
    filter: detected?.filter,
    network: detected?.network,
    testAnswers,
  } satisfies Connection;
});

/** Whether detection found a filter, found none, or couldn't tell. */
export const connectionState = (c: Connection): ConnectionState => {
  if (c.filter !== undefined) {
    return "detected";
  }
  if (c.error !== undefined) {
    return "unknown";
  }
  return "none";
};

/** One phrase for the filter on this computer, as the text output shows it. */
export const connectionText = (c: Connection): string =>
  stateText[connectionState(c)](c);
