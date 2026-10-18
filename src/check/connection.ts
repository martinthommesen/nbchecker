/** Works out which filter, if any, this computer's own DNS goes through. */
import { Effect, Result } from "effect";
import { Dns, NetAddress } from "effect/net";
import { telenorTestPage } from "./known-answers.ts";

/** Which of Telenor's filters gives this answer to its test page, if any. */
const detectedBy = (ip: string): Detected | undefined => {
  const filter = telenorTestPage.answers.find((a) => a.ip === ip)?.filter;
  if (filter === undefined) {
    return;
  }
  return { filter, network: "Telenor" };
};

interface Detected {
  readonly filter: string | undefined;
  /** The network the filter belongs to; only known along with the filter. */
  readonly network: string | undefined;
}

export interface Connection extends Detected {
  /** Why the test lookup failed, if it did. */
  readonly error: string | undefined;
  /** The addresses this computer got for the test page. */
  readonly testAnswers: readonly string[];
}

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
    const error = addresses.failure;
    let notFound = false;
    if (error._tag === "DnsError") {
      notFound = error.reason === "NotFound";
    }
    const connection: Connection = {
      error: String(error.message),
      filter: undefined,
      network: undefined,
      testAnswers: [],
    };
    if (notFound) {
      return { ...connection, error: undefined };
    }
    return connection;
  }
  const testAnswers = addresses.success.map(NetAddress.formatIp);
  const detected = testAnswers.map(detectedBy).find((d) => d !== undefined);
  return {
    error: undefined,
    filter: detected?.filter,
    network: detected?.network,
    testAnswers,
  } satisfies Connection;
});

/** One phrase for the filter on this computer, as the text output shows it. */
export const connectionText = (c: Connection): string => {
  if (c.filter !== undefined) {
    return c.filter;
  }
  if (c.error !== undefined) {
    return "unknown";
  }
  return "none detected";
};
