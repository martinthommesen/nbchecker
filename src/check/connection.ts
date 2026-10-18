/** Works out which filter, if any, this computer's own DNS goes through. */
import { Effect, Result } from "effect";
import { Dns, NetAddress } from "effect/net";

/** Telenor's test page answers with a different address per filter. */
const testPageAnswers = new Map<string, Detected>([
  ["148.123.15.1", { filter: "Telenor Nettvern+", network: "Telenor" }],
  ["148.123.15.37", { filter: undefined, network: "Telenor" }],
  ["148.123.15.38", { filter: "Telenor Nettvern", network: "Telenor" }],
]);

const testPageName = "nettvern.telenor.net";

interface Detected {
  readonly filter: string | undefined;
  readonly network: string | undefined;
}

export interface Connection extends Detected {
  /** Why the test lookup failed, if it did. */
  readonly error: string | undefined;
  /** The addresses this computer got for the test page. */
  readonly testAnswers: readonly string[];
}

/** The addresses each answer from Telenor's test page stands for. */
export const testPageMeaning: readonly (readonly [string, string])[] = [
  ["148.123.15.38", "Nettvern"],
  ["148.123.15.1", "Nettvern+"],
  ["148.123.15.37", "no filter"],
];

/**
 * Looks up the test page through this computer's resolver. Only Telenor
 * publishes such a page so far, so other filters are not detected.
 */
export const detectConnection = Effect.gen(function* () {
  const dns = yield* Dns.Dns;
  const addresses = yield* dns
    .lookup(testPageName)
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
  const detected = testAnswers
    .map((ip) => testPageAnswers.get(ip))
    .find((d) => d !== undefined);
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
  if (c.network !== undefined) {
    return `none (${c.network} DNS without a filter)`;
  }
  if (c.error !== undefined) {
    return "unknown";
  }
  return "none detected";
};

export const testPage = testPageName;
