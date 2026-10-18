import { Result } from "effect";
import { Host, NetAddress } from "effect/net";

const pathStart = /[/?#]/;
const trailingDot = /\.$/;

const schemeSeparator = "://";

const stripUrl = (input: string): string => {
  let s = input.trim();
  const scheme = s.indexOf(schemeSeparator);
  if (scheme !== -1) {
    s = s.slice(scheme + schemeSeparator.length);
  }
  const path = s.search(pathStart);
  if (path !== -1) {
    s = s.slice(0, path);
  }
  const at = s.lastIndexOf("@");
  if (at !== -1) {
    s = s.slice(at + 1);
  }
  return s;
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

export interface Target {
  /** The name to look up, in its ASCII (xn--) form, or the IP address. */
  readonly host: string;
  readonly kind: "domain" | "invalid" | "ip";
}

/** Accepts a domain, a URL or an IP address. */
export const normalize = (input: string): Target => {
  const s = stripPort(stripUrl(input)).replace(trailingDot, "");
  const ip = NetAddress.ipFromString(s);
  if (Result.isSuccess(ip)) {
    return { host: NetAddress.formatIp(ip.success), kind: "ip" };
  }
  const name = Host.domainNameFromString(s);
  if (Result.isSuccess(name)) {
    return { host: Host.toRelative(name.success), kind: "domain" };
  }
  return { host: s, kind: "invalid" };
};
