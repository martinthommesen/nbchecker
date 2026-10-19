import { describe, expect, test } from "bun:test";
import {
  blockedName,
  designComputerWith,
  realAddress,
  redirectedDesignTransport,
  slowDesignTransport,
} from "../testing/design-network.ts";
import { useTui } from "../testing/tui-session.ts";

/** The narrowest terminal the README promises to fit. */
const narrowWidth = 80;
/** The blocked count, unbroken by wrapping. */
const blockedSoFar = /blocked so far: \d/u;
const settleMs = 100;
const quad9Untested = /· Quad9\s+no test page\s+· no test name/u;
const cloudflarePassed = /· Cloudflare Family\s+no test page\s+✓ passed/u;
const cloudflareRedirected =
  /Cloudflare Family\s+no test page\s+\? redirected\?/u;

/** On Telenor's network with Nettvern, but its DNS doesn't block the name. */
const unblockedComputer = designComputerWith(realAddress);

const start = useTui();

describe("tui", () => {
  test("lists the filters by category before anything is checked", async () => {
    const s = await start();
    const screen = await s.until("✕ Telenor Nettvern");
    expect(screen).toContain("SECURITY · MALWARE, PHISHING");
    expect(screen).toContain("ADS AND TRACKERS");
    expect(screen).toContain("Quad9");
  });

  test("checks a domain and shows each resolver's verdict", async () => {
    const s = await start();
    const screen = await s.check({ until: "BLOCKED" });
    expect(screen).toContain("by 8 of 9 filters");
    expect(screen).toContain("CNAME nettvern-info.telenor.net");
    expect(screen).toContain("NXDOMAIN · EDE 15");
    expect(screen).toContain(`real answer: ${realAddress}`);
  });

  test("the details pane follows the selection", async () => {
    const s = await start();
    await s.check({ until: "BLOCKED" });
    s.input.pressArrow("down");
    const screen = await s.until("cloudflare-dns.com");
    expect(screen).toContain("HTTPS 443");
  });

  test("a cancelled check shows no verdict", async () => {
    const s = await start({ transport: slowDesignTransport });
    await s.check({ until: "answered" });
    s.input.pressEscape();
    const screen = await s.until("CANCELLED");
    expect(screen).not.toContain("NOT BLOCKED");
    expect(screen).toContain("cancelled");
  });

  test("shows the connection screen and goes back", async () => {
    const s = await start();
    await s.check({ until: "BLOCKED" });
    s.input.pressKey("c");
    const screen = await s.until("Filters we look for");
    expect(screen).toContain("can't see");
    s.input.pressEscape();
    await s.until("BLOCKED");
  });
});

describe("tui while typing a target", () => {
  test("leaving a new check shows the checked domain again", async () => {
    const s = await start();
    await s.check({ target: blockedName, until: "BLOCKED" });
    s.input.pressKey("/");
    await s.until("a domain, URL or IP address");
    s.input.pressEscape();
    const screen = await s.until(`› ${blockedName}`);
    expect(screen).not.toContain("a domain, URL or IP address");
  });

  test("the / that starts a new check isn't typed into it", async () => {
    const s = await start();
    await s.check({ until: "BLOCKED" });
    s.input.pressKey("/");
    await s.until("a domain, URL or IP address");
    const screen = await s.check({
      target: "example.com",
      until: "A + AAAA example.com",
    });
    expect(screen).not.toContain("/example.com");
    expect(screen).toContain("› example.com");
  });

  test("esc on the start screen doesn't quit", async () => {
    const s = await start();
    await s.until("Quad9");
    s.input.pressEscape();
    expect(await s.endsWithin(settleMs)).toBe(false);
    await s.check({ until: "BLOCKED" });
  });
});

describe("tui: the self-test", () => {
  test("the connection screen lists each filter's self-test", async () => {
    const s = await start();
    await s.check({ until: "BLOCKED" });
    s.input.pressKey("c");
    const screen = await s.until("✓ passed");
    expect(screen).toMatch(cloudflarePassed);
    // Quad9 documents no test name, so it isn't self-tested.
    expect(screen).toMatch(quad9Untested);
    expect(screen).not.toContain("? redirected?");
  });

  test("a redirecting network is flagged on every screen", async () => {
    const s = await start({
      computer: unblockedComputer,
      transport: redirectedDesignTransport,
    });
    const screen = await s.check({ until: "INTERCEPTED?" });
    expect(screen).toContain("results can't be trusted");
    expect(screen).toContain("? DNS intercepted");
    expect(screen).toContain("untrusted");
    expect(screen).not.toContain("NOT BLOCKED");
    s.input.pressKey("c");
    const connection = await s.until("self-test");
    expect(connection).toMatch(cloudflareRedirected);
  });

  test("this computer's block stays the headline", async () => {
    const s = await start({ transport: redirectedDesignTransport });
    const screen = await s.check({
      until: "by your DNS, but by none of the filters",
    });
    expect(screen).toContain("? DNS intercepted");
    expect(screen).toContain("untrusted");
  });
});

describe("tui: copying", () => {
  test("a result that couldn't be checked still names the detected filter", async () => {
    const s = await start();
    // A first check waits for the network to be detected.
    await s.check({ until: "BLOCKED" });
    s.input.pressKey("/");
    await s.check({ target: "not a name!", until: "not a name!" });
    s.input.pressKey("y");
    expect(s.copied()).toStartWith(
      "DNS filter on this computer: Telenor Nettvern"
    );
  });
});

describe("tui on a narrow terminal", () => {
  test("the checking line fits a narrow terminal", async () => {
    const s = await start({
      transport: slowDesignTransport,
      width: narrowWidth,
    });
    const screen = await s.check({ until: "answered" });
    const line = screen.split("\n").find((l) => l.includes("answered"));
    expect(line).toContain("Checking");
    expect(screen).toMatch(blockedSoFar);
  });
});
