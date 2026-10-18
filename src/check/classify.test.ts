import { describe, expect, test } from "bun:test";
import { type DnsAnswer, type DnsRecord, Rcode } from "../dns/wire.ts";
import {
  canonicalAddress,
  classify,
  describe as describeVerdict,
  merge,
  type Reason,
} from "./classify.ts";

const edeFiltered = 17;
const edeStale = 3;

const answer = (
  records: readonly DnsRecord[],
  extra: Partial<DnsAnswer> = {}
): DnsAnswer => ({
  extendedErrors: [],
  rcode: Rcode.noError,
  records,
  truncated: false,
  ...extra,
});

const cname = (name: string, value: string): DnsRecord => ({
  name,
  type: "CNAME",
  value,
});
const a = (name: string, value: string): DnsRecord => ({
  name,
  type: "A",
  value,
});
const aaaa = (name: string, value: string): DnsRecord => ({
  name,
  type: "AAAA",
  value,
});

interface Case {
  readonly answer: DnsAnswer;
  readonly detail?: string;
  readonly exists?: boolean;
  readonly name: string;
  readonly reason: Reason | undefined;
}

// Block answers follow the shapes the filters send. Names and addresses are
// placeholders.
const cases: readonly Case[] = [
  {
    answer: answer([
      cname("blocked.example", "nettvern-info.telenor.net"),
      a("nettvern-info.telenor.net", "148.123.15.44"),
    ]),
    name: "Telenor Nettvern",
    reason: "nettvern",
  },
  {
    answer: answer([
      cname("blocked.example", "nettvernpluss-info.telenor.net"),
      a("nettvernpluss-info.telenor.net", "148.123.15.2"),
    ]),
    name: "Telenor Nettvern+",
    reason: "nettvern+",
  },
  {
    answer: answer([cname("blocked.example", "dns-block.telenor.net")]),
    name: "Telenor legal block, AAAA query with no address",
    reason: "legal",
  },
  {
    answer: answer([a("blocked.example", "146.112.61.108")]),
    detail: "phishing",
    name: "Umbrella phishing page",
    reason: "umbrella",
  },
  {
    answer: answer([aaaa("blocked.example", "::ffff:146.112.61.107")]),
    detail: "malware",
    name: "Umbrella page as a mapped IPv6 address",
    reason: "umbrella",
  },
  {
    answer: answer([a("grey.example", "146.112.56.167")]),
    name: "Umbrella proxy",
    reason: "umbrella-proxy",
  },
  {
    answer: answer([a("blocked.example", "0.0.0.0")]),
    name: "null A (Cloudflare, AdGuard)",
    reason: "null-ip",
  },
  {
    answer: answer([aaaa("blocked.example", "::")]),
    name: "null AAAA",
    reason: "null-ip",
  },
  {
    answer: answer([], {
      extendedErrors: [{ code: edeFiltered, text: "malware" }],
    }),
    detail: "Filtered: malware",
    name: "Extended DNS Error",
    reason: "ede",
  },
  {
    answer: answer([a("ok.example", "192.0.2.20")], {
      extendedErrors: [{ code: edeStale, text: "" }],
    }),
    name: "unrelated Extended DNS Error",
    reason: undefined,
  },
  {
    answer: answer([], { rcode: Rcode.nxDomain }),
    name: "filter-only NXDOMAIN (Quad9)",
    reason: "nxdomain",
  },
  {
    answer: answer([], { rcode: Rcode.nxDomain }),
    exists: false,
    name: "NXDOMAIN for a name that doesn't exist",
    reason: undefined,
  },
  {
    answer: answer([
      cname("www.ok.example", "ok.example"),
      a("ok.example", "192.0.2.20"),
    ]),
    name: "ordinary CNAME",
    reason: undefined,
  },
];

describe("classify", () => {
  test.each(cases.map((c) => [c.name, c] as const))("%s", (_, c) => {
    const v = classify(c.answer, c.exists ?? true);
    expect(v.reason).toBe(c.reason);
    expect(v.blocked).toBe(c.reason !== undefined);
    expect(v.detail).toBe(c.detail ?? "");
  });

  test("CNAME targets match without case or trailing dot differences", () => {
    const v = classify(
      answer([cname("x.example", "nettvern-info.telenor.net")]),
      true
    );
    expect(v.reason).toBe("nettvern");
  });
});

test("merge keeps the block and removes duplicate answers", () => {
  const plain = classify(answer([a("x.example", "192.0.2.1")]), true);
  const blocked = classify(
    answer([
      cname("x.example", "nettvern-info.telenor.net"),
      a("nettvern-info.telenor.net", "192.0.2.1"),
    ]),
    true
  );
  const merged = merge(plain, blocked);
  expect(merged.reason).toBe("nettvern");
  expect(merged.answers).toEqual(["192.0.2.1", "nettvern-info.telenor.net"]);
});

test("canonicalAddress unmaps IPv4-mapped IPv6 and shortens IPv6", () => {
  expect(canonicalAddress("::ffff:192.0.2.1")).toBe("192.0.2.1");
  expect(canonicalAddress("2001:0db8:0000::0001")).toBe("2001:db8::1");
  expect(canonicalAddress("not-an-ip")).toBe("not-an-ip");
});

test("describe", () => {
  const missing = classify(answer([], { rcode: Rcode.nxDomain }), false);
  expect(describeVerdict(missing)).toBe("not found (the domain doesn't exist)");
  const umbrella = classify(answer([a("x.example", "146.112.61.108")]), true);
  expect(describeVerdict(umbrella)).toBe(
    "blocked by Cisco Umbrella (phishing)"
  );
});
