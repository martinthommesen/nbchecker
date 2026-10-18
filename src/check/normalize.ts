import { Result } from "effect";
import { Host, NetAddress } from "effect/net";

/** A URL scheme such as "https://", only at the very start. */
const scheme = /^[a-z][a-z\d+.-]*:\/\//i;
/** Where the host of a schemeless input ends, as in a browser's address bar. */
const pathStart = /[/?#\\]/;
const trailingDot = /\.$/;

/**
 * The host of an input with a scheme, read by the standard URL parser so it
 * is the host a browser would open. Undefined for an input without a scheme,
 * and "" for a URL that doesn't parse.
 */
const urlHost = (input: string): string | undefined => {
  let url = input;
  if (input.startsWith("//")) {
    url = `https:${input}`;
  } else if (!scheme.test(input)) {
    return;
  }
  if (!URL.canParse(url)) {
    return "";
  }
  const { hostname } = new URL(url);
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
};

const stripPort = (s: string): string => {
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    if (end !== -1) {
      return s.slice(1, end);
    }
  }
  // One colon means host:port; more means a bare IPv6 address.
  const colon = s.indexOf(":");
  if (colon !== -1 && colon === s.lastIndexOf(":")) {
    return s.slice(0, colon);
  }
  return s;
};

/** The host of a schemeless input: everything before the first / ? # or \. */
const bareHost = (input: string): string => {
  let s = input;
  const path = s.search(pathStart);
  if (path !== -1) {
    s = s.slice(0, path);
  }
  const at = s.lastIndexOf("@");
  if (at !== -1) {
    s = s.slice(at + 1);
  }
  return stripPort(s);
};

export interface Target {
  /** The name to show, in its ASCII (xn--) form, or the IP address. */
  readonly host: string;
  readonly kind: "domain" | "invalid" | "ip";
  /**
   * The name to look up: the host, with the trailing dot kept when the input
   * had one, so this computer's resolver doesn't add a search domain.
   */
  readonly query: string;
}

/** Accepts a domain, a URL or an IP address. */
export const normalize = (input: string): Target => {
  const trimmed = input.trim();
  const host = urlHost(trimmed) ?? bareHost(trimmed);
  const absolute = host.length > 1 && trailingDot.test(host);
  const s = host.replace(trailingDot, "");
  const ip = NetAddress.ipFromString(s);
  if (Result.isSuccess(ip)) {
    const address = NetAddress.formatIp(ip.success);
    return { host: address, kind: "ip", query: address };
  }
  const name = Host.domainNameFromString(s);
  if (s !== "" && Result.isSuccess(name)) {
    const relative = Host.toRelative(name.success);
    let query: string = relative;
    if (absolute) {
      query = `${relative}.`;
    }
    return { host: relative, kind: "domain", query };
  }
  let shown = s;
  if (shown === "") {
    shown = trimmed;
  }
  return { host: shown, kind: "invalid", query: shown };
};
