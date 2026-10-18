import { expect, test } from "bun:test";
import { normalize } from "./normalize.ts";

test.each([
  ["Example.COM.", "example.com", "domain"],
  ["https://me@www.example.com:8080/a?b", "www.example.com", "domain"],
  ["example.no/nyheter", "example.no", "domain"],
  ["https://Blåbær.no/", "xn--blbr-roah.no", "domain"],
  ["192.0.2.1", "192.0.2.1", "ip"],
  ["[2001:db8::1]:443", "2001:db8::1", "ip"],
  ["http://[2001:db8::1]/", "2001:db8::1", "ip"],
  ["2001:db8::1", "2001:db8::1", "ip"],
  ["not a name!", "not a name!", "invalid"],
] as const)("reads %s", (input, host, kind) => {
  expect(normalize(input)).toEqual({ host, kind });
});
