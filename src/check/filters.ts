/** The filtering DNS services nbchecker asks. */

/** What a filter blocks; results are grouped by this, not by provider. */
export type Category = "ads" | "family" | "security";

/**
 * A filtering DNS service. Each is reachable over IPv4 and IPv6; nbchecker
 * asks all of its addresses at once and uses the first answer, because a
 * VPN or firewall often blocks one address family.
 */
export interface Filter {
  readonly category: Category;
  readonly name: string;
  /** Set when the servers only answer some networks, such as one ISP's. */
  readonly onlyAnswers?: string;
  readonly servers: readonly string[];
}

export const filters: readonly Filter[] = [
  {
    category: "security",
    name: "Telenor Nettvern",
    onlyAnswers: "Telenor customers",
    servers: [
      "148.122.16.253",
      "148.122.164.253",
      "2001:4600:4:fff::253",
      "2001:4600:4:1fff::253",
    ],
  },
  {
    category: "family",
    name: "Telenor Nettvern+",
    onlyAnswers: "Telenor customers",
    servers: [
      "148.122.16.252",
      "148.122.164.252",
      "2001:4600:4:fff::252",
      "2001:4600:4:1fff::252",
    ],
  },
  {
    category: "security",
    name: "Cloudflare Security",
    servers: [
      "1.1.1.2",
      "1.0.0.2",
      "2606:4700:4700::1112",
      "2606:4700:4700::1002",
    ],
  },
  {
    category: "family",
    name: "Cloudflare Family",
    servers: [
      "1.1.1.3",
      "1.0.0.3",
      "2606:4700:4700::1113",
      "2606:4700:4700::1003",
    ],
  },
  {
    category: "security",
    name: "Quad9",
    servers: ["9.9.9.9", "149.112.112.112", "2620:fe::fe", "2620:fe::9"],
  },
  {
    category: "family",
    name: "OpenDNS FamilyShield",
    servers: [
      "208.67.222.123",
      "208.67.220.123",
      "2620:119:35::123",
      "2620:119:53::123",
    ],
  },
  {
    category: "family",
    name: "AdGuard Family",
    servers: [
      "94.140.14.15",
      "94.140.15.16",
      "2a10:50c0::bad1:ff",
      "2a10:50c0::bad2:ff",
    ],
  },
  {
    category: "family",
    name: "CleanBrowsing Family",
    servers: [
      "185.228.168.168",
      "185.228.169.168",
      "2a0d:2a00:1::",
      "2a0d:2a00:2::",
    ],
  },
  {
    category: "ads",
    name: "AdGuard DNS",
    servers: [
      "94.140.14.14",
      "94.140.15.15",
      "2a10:50c0::ad1:ff",
      "2a10:50c0::ad2:ff",
    ],
  },
  {
    category: "security",
    name: "CleanBrowsing Security",
    servers: [
      "185.228.168.9",
      "185.228.169.9",
      "2a0d:2a00:1::2",
      "2a0d:2a00:2::2",
    ],
  },
];

/** Unfiltered DNS-over-HTTPS resolvers give the real answer from anywhere. */
export const truthResolvers: readonly string[] = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/dns-query",
];
