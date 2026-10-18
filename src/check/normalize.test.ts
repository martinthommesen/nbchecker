import { describe, expect, test } from "bun:test";
import { normalize } from "./normalize.ts";

describe("normalize", () => {
  test.each([
    ["Example.COM.", "example.com", "domain"],
    ["https://me@www.example.com:8080/a?b", "www.example.com", "domain"],
    ["example.no/nyheter", "example.no", "domain"],
    ["https://Blåbær.no/", "xn--blbr-roah.no", "domain"],
    ["192.0.2.1", "192.0.2.1", "ip"],
    ["[2001:db8::1]:443", "2001:db8::1", "ip"],
    ["http://[2001:db8::1]/", "2001:db8::1", "ip"],
    ["2001:db8::1", "2001:db8::1", "ip"],
    ["example.com:8443", "example.com", "domain"],
    ["me@example.com", "example.com", "domain"],
    ["not a name!", "not a name!", "invalid"],
  ] as const)("reads %s", (input, host, kind) => {
    expect(normalize(input)).toMatchObject({ host, kind });
  });

  // A browser opens the host the URL parser finds, so that is the one to check.
  test.each([
    ["https://good.example\\@evil.example/", "good.example"],
    ["good.example/?next=https://evil.example/", "good.example"],
    ["www.example.com/url?q=https://evil.example", "www.example.com"],
    ["good.example#https://evil.example", "good.example"],
    ["good.example\\@evil.example", "good.example"],
    ["//good.example/path", "good.example"],
    ["https://%67ood.example/", "good.example"],
    ["HTTPS://GOOD.EXAMPLE/", "good.example"],
    ["https://192.0.2.1:8443/", "192.0.2.1"],
  ] as const)("checks the host a browser would open for %s", (input, host) => {
    expect(normalize(input).host).toBe(host);
  });

  test.each([
    "https://good.example:99999/",
    "https://[2001:db8::1/",
    "https://exa mple.com/",
  ])("rejects the malformed URL %s", (input) => {
    expect(normalize(input).kind).toBe("invalid");
  });

  test("keeps a trailing dot for the lookups, not for showing", () => {
    expect(normalize("Example.COM.")).toEqual({
      host: "example.com",
      kind: "domain",
      query: "example.com.",
    });
    expect(normalize("https://example.com./")).toMatchObject({
      host: "example.com",
      query: "example.com.",
    });
    expect(normalize("example.com").query).toBe("example.com");
  });
});
