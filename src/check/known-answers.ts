/**
 * The answers providers document their filters giving: Telenor's test page,
 * which tells its filters apart, and the block answers nbchecker recognises.
 */
import type { Reason } from "./classify.ts";

/** One answer from Telenor's test page, and what it says about the resolver. */
interface TestPageAnswer {
  /** The Telenor filter that gives it, as its `Filter.name` says. */
  readonly filter?: string;
  readonly ip: string;
  readonly meaning: string;
}

interface TestPage {
  /** In the order the connection screen lists them. */
  readonly answers: readonly TestPageAnswer[];
  readonly name: string;
}

/**
 * Telenor's test page. Telenor's filters each give an address of their own;
 * every other resolver, Telenor's unfiltered one, Google and Cloudflare
 * included, gets the public answer, so that one says nothing about the
 * network.
 */
export const telenorTestPage: TestPage = {
  answers: [
    { filter: "Telenor Nettvern", ip: "148.123.15.38", meaning: "Nettvern" },
    { filter: "Telenor Nettvern+", ip: "148.123.15.1", meaning: "Nettvern+" },
    { ip: "148.123.15.37", meaning: "public answer (no filter)" },
  ],
  name: "nettvern.telenor.net",
};

/** Telenor answers a blocked name with a CNAME to one of these hosts. */
export const telenorBlockCnames: ReadonlyMap<string, Reason> = new Map<
  string,
  Reason
>([
  ["dns-block.telenor.net", "legal"],
  ["kid.telenor.net", "kripos"],
  ["nettvern-info.telenor.net", "nettvern"],
  ["nettvernpluss-info.telenor.net", "nettvern+"],
]);

/**
 * Cisco Umbrella's block pages, as OpenDNS answers them, and what each one
 * means. The first is the page for a name on a domain list.
 */
export const umbrellaBlockPages: ReadonlyMap<string, string> = new Map([
  ["146.112.61.104", "domain list"],
  ["146.112.61.105", "command and control"],
  ["146.112.61.106", "content category"],
  ["146.112.61.107", "malware"],
  ["146.112.61.108", "phishing"],
  ["146.112.61.109", "blocked"],
  ["146.112.61.110", "security"],
]);

/**
 * Cisco Umbrella's inspection proxy. A name sent there isn't blocked by DNS;
 * the proxy checks the pages as they load, and may block some URLs.
 */
export const umbrellaProxyPrefix = "146.112.56.";

/** AdGuard Family's block page, which it answers adult sites with. */
export const adguardBlockPages: ReadonlySet<string> = new Set(["94.140.14.35"]);

/** Cloudflare's and AdGuard's filters answer a blocked name with these. */
export const nullAddresses: readonly string[] = ["0.0.0.0", "::"];
