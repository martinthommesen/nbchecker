import { expect, test } from "bun:test";
import { a, aaaa, answer, cname } from "../testing/records.ts";
import { addressesIn, canonicalAddress } from "./address.ts";

test("canonicalAddress unmaps IPv4-mapped IPv6 and shortens IPv6", () => {
  expect(canonicalAddress("::ffff:192.0.2.1")).toBe("192.0.2.1");
  expect(canonicalAddress("2001:0db8:0000::0001")).toBe("2001:db8::1");
  expect(canonicalAddress("not-an-ip")).toBe("not-an-ip");
});

test("addressesIn keeps the answers' addresses in order, without CNAMEs", () => {
  const answers = [
    answer([cname("x.example", "y.example"), a("y.example", "192.0.2.1")]),
    answer([aaaa("y.example", "2001:db8::1")]),
  ];
  expect(addressesIn(answers)).toEqual(["192.0.2.1", "2001:db8::1"]);
});
