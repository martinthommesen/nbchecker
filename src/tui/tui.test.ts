import { afterEach, describe, expect, test } from "bun:test";
import { sleep } from "bun";
import { blockedName, slowDesignTransport } from "../testing/design-network.ts";
import { startTui, type TuiSession } from "../testing/tui-session.ts";

/** The narrowest terminal the README promises to fit. */
const narrowWidth = 80;
/** The blocked count, unbroken by wrapping. */
const blockedSoFar = /blocked so far: \d/u;
const settleMs = 100;

let current: TuiSession | undefined;

const start = async (options?: Parameters<typeof startTui>[0]) => {
  current = await startTui(options);
  return current;
};

const checkBlocked = async (s: TuiSession) => {
  await s.input.typeText(blockedName);
  s.input.pressEnter();
  return await s.until("BLOCKED");
};

afterEach(async () => {
  await current?.stop();
  current = undefined;
});

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
    const screen = await checkBlocked(s);
    expect(screen).toContain("by 8 of 10 filters");
    expect(screen).toContain("CNAME nettvern-info.telenor.net");
    expect(screen).toContain("NXDOMAIN · EDE 15");
    expect(screen).toContain("real answer: 203.0.113.42");
  });

  test("the details pane follows the selection", async () => {
    const s = await start();
    await checkBlocked(s);
    s.input.pressArrow("down");
    const screen = await s.until("cloudflare-dns.com");
    expect(screen).toContain("HTTPS 443");
  });

  test("a cancelled check shows no verdict", async () => {
    const s = await start({ transport: slowDesignTransport });
    await s.input.typeText(blockedName);
    s.input.pressEnter();
    await s.until("answered");
    s.input.pressEscape();
    const screen = await s.until("CANCELLED");
    expect(screen).not.toContain("NOT BLOCKED");
    expect(screen).toContain("cancelled");
  });

  test("shows the connection screen and goes back", async () => {
    const s = await start();
    await checkBlocked(s);
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
    await checkBlocked(s);
    s.input.pressKey("/");
    await s.until("a domain, URL or IP address");
    s.input.pressEscape();
    const screen = await s.until(`› ${blockedName}`);
    expect(screen).not.toContain("a domain, URL or IP address");
  });

  test("the / that starts a new check isn't typed into it", async () => {
    const s = await start();
    await checkBlocked(s);
    s.input.pressKey("/");
    await s.until("a domain, URL or IP address");
    await s.input.typeText("example.com");
    s.input.pressEnter();
    const screen = await s.until("A + AAAA example.com");
    expect(screen).not.toContain("/example.com");
    expect(screen).toContain("› example.com");
  });

  test("esc on the start screen doesn't quit", async () => {
    const s = await start();
    await s.until("Quad9");
    s.input.pressEscape();
    const ended = await Promise.race([
      s.ended.then(() => true),
      sleep(settleMs).then(() => false),
    ]);
    expect(ended).toBe(false);
    await s.input.typeText(blockedName);
    s.input.pressEnter();
    await s.until("BLOCKED");
  });
});

describe("tui on a narrow terminal", () => {
  test("the checking line fits a narrow terminal", async () => {
    const s = await start({
      transport: slowDesignTransport,
      width: narrowWidth,
    });
    await s.input.typeText(blockedName);
    s.input.pressEnter();
    const screen = await s.until("answered");
    const line = screen.split("\n").find((l) => l.includes("answered"));
    expect(line).toContain("Checking");
    expect(screen).toMatch(blockedSoFar);
  });
});
