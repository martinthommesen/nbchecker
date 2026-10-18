import { describe, expect, test } from "bun:test";
import { Ede, Rcode } from "../dns/codes.ts";
import type { DnsAnswer, DnsRecord } from "../dns/wire.ts";
import {
  canonicalAddress,
  classify,
  classifySystem,
  describe as describeVerdict,
  merge,
  type Reason,
  type Reference,
} from "./classify.ts";

const edeStale = 3;

/** The real answer for a name that exists, with an address of its own. */
const exists: Reference = { addresses: ["192.0.2.20"], exists: true };
const missing: Reference = { addresses: [], exists: false };

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
  readonly name: string;
  readonly reason: Reason | undefined;
  /** The real answer; by default, the name exists. */
  readonly reference?: Reference;
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
    answer: answer([a("adult.example", "94.140.14.35")]),
    name: "AdGuard Family's block page",
    reason: "adguard",
  },
  {
    answer: answer([], {
      extendedErrors: [{ code: Ede.blocked, text: "" }],
      rcode: Rcode.servFail,
    }),
    detail: "Blocked",
    name: "SERVFAIL with Extended DNS Error 15",
    reason: "ede",
  },
  {
    answer: answer([], {
      extendedErrors: [{ code: Ede.blocked, text: "policy" }],
      rcode: Rcode.refused,
    }),
    detail: "Blocked: policy",
    name: "REFUSED with Extended DNS Error 15",
    reason: "ede",
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
      extendedErrors: [{ code: Ede.filtered, text: "malware" }],
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
    name: "NXDOMAIN for a name that doesn't exist",
    reason: undefined,
    reference: missing,
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
    const v = classify(c.answer, c.reference ?? exists);
    expect(v.reason).toBe(c.reason);
    expect(v.blocked).toBe(c.reason !== undefined);
    expect(v.detail).toBe(c.detail ?? "");
  });

  test("CNAME targets match without case or trailing dot differences", () => {
    const v = classify(
      answer([cname("x.example", "nettvern-info.telenor.net")]),
      exists
    );
    expect(v.reason).toBe("nettvern");
  });
});

test("merge keeps the block and removes duplicate answers", () => {
  const plain = classify(answer([a("x.example", "192.0.2.1")]), exists);
  const blocked = classify(
    answer([
      cname("x.example", "nettvern-info.telenor.net"),
      a("nettvern-info.telenor.net", "192.0.2.1"),
    ]),
    exists
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
  const absent = classify(answer([], { rcode: Rcode.nxDomain }), missing);
  expect(describeVerdict(absent)).toBe("not found (the domain doesn't exist)");
  const umbrella = classify(answer([a("x.example", "146.112.61.108")]), exists);
  expect(describeVerdict(umbrella)).toBe(
    "blocked by Cisco Umbrella (phishing)"
  );
});

describe("classify: compared with the real answer", () => {
  const zero: Reference = { addresses: ["0.0.0.0"], exists: true };

  test("a domain whose own record is 0.0.0.0 is not blocked", () => {
    const v = classify(answer([a("zero.example", "0.0.0.0")]), zero);
    expect(v.blocked).toBe(false);
    expect(v.answers).toEqual(["0.0.0.0"]);
  });

  test("an Extended DNS Error still counts", () => {
    const v = classify(
      answer([a("zero.example", "0.0.0.0")], {
        extendedErrors: [{ code: Ede.filtered, text: "" }],
      }),
      zero
    );
    expect(v.reason).toBe("ede");
  });

  test("an Umbrella block page the real answer also has is not a block", () => {
    const page: Reference = { addresses: ["146.112.61.108"], exists: true };
    const v = classify(answer([a("x.example", "146.112.61.108")]), page);
    expect(v.blocked).toBe(false);
  });
});

describe("classify: Cisco's inspection proxy", () => {
  const proxied = answer([a("grey.example", "146.112.56.167")]);

  test("is inspected, not blocked", () => {
    const v = classify(proxied, exists);
    expect(v).toMatchObject({
      blocked: false,
      inspected: true,
      reason: "umbrella-proxy",
    });
    expect(describeVerdict(v)).toBe(
      "sent through Cisco's inspection proxy; the site may still be blocked by URL"
    );
  });

  test("a block in the other answer wins", () => {
    const blocked = classify(answer([aaaa("grey.example", "::")]), exists);
    const v = merge(classify(proxied, exists), blocked);
    expect(v).toMatchObject({
      blocked: true,
      inspected: false,
      reason: "null-ip",
    });
  });
});

describe("classifySystem", () => {
  const noAddress = answer([]);
  const v6: Reference = { addresses: ["2001:db8::6"], exists: true };
  const none: Reference = { addresses: [], exists: true };

  test("no address for a name with an IPv4 address is a block", () => {
    const v = classifySystem(noAddress, true, exists);
    expect(v).toMatchObject({
      blocked: true,
      missing: true,
      reason: "no-address",
    });
  });

  test("no address for a name without one, or only IPv6, is not", () => {
    expect(classifySystem(noAddress, true, none).blocked).toBe(false);
    expect(classifySystem(noAddress, true, v6).blocked).toBe(false);
    expect(classifySystem(noAddress, true, missing).missing).toBe(true);
  });

  test("an address is read like a filter's answer", () => {
    const v = classifySystem(
      answer([a("x.example", "0.0.0.0")]),
      false,
      exists
    );
    expect(v.reason).toBe("null-ip");
  });
});
