/** Works out which filter, if any, this computer's own DNS goes through. */
import { Effect, Result } from "effect";
import { Dns, NetAddress } from "effect/net";

/**
 * What each answer from Telenor's test page means. Telenor's filters give an
 * address of their own; every other resolver, Telenor's unfiltered one, Google
 * and Cloudflare included, gets the public answer, so that one says nothing
 * about the network.
 */
const testPageAnswers: readonly {
  readonly filter?: string;
  readonly ip: string;
  readonly meaning: string;
}[] = [
  { filter: "Telenor Nettvern", ip: "148.123.15.38", meaning: "Nettvern" },
  { filter: "Telenor Nettvern+", ip: "148.123.15.1", meaning: "Nettvern+" },
  { ip: "148.123.15.37", meaning: "public answer (no filter)" },
];

const detectedBy = (ip: string): Detected | undefined => {
  const filter = testPageAnswers.find((a) => a.ip === ip)?.filter;
  if (filter === undefined) {
    return;
  }
  return { filter, network: "Telenor" };
};

const testPageName = "nettvern.telenor.net";

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

/** The addresses each answer from Telenor's test page stands for. */
export const testPageMeaning: readonly (readonly [string, string])[] =
  testPageAnswers.map((a) => [a.ip, a.meaning]);

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

export const testPage = testPageName;
