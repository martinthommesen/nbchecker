import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { DnsTransport } from "../dns/transport.ts";
import { type DnsAnswer, Rcode } from "../dns/wire.ts";
import { blockedName } from "../testing/design-network.ts";
import { startTui, type TuiSession } from "../testing/tui-session.ts";

const tiny = { height: 12, width: 40 };
const small = { height: 24, width: 80 };
const pages = 4;
const longAddress = ["2001:db8:1234:5678", "abcd:ef12:3456:789a"].join(":");

const manyAddresses = 12;
const firstHost = 1;

/** A dozen IPv4 addresses, and one long IPv6 address. */
const addresses = new Map([
  [
    "A",
    Array.from({ length: manyAddresses }, (_, i) => `192.0.2.${i + firstHost}`),
  ],
  ["AAAA", [longAddress]],
]);

const answerOf = (name: string, type: "A" | "AAAA"): DnsAnswer => ({
  extendedErrors: [],
  rcode: Rcode.noError,
  records: (addresses.get(type) ?? []).map((value) => ({ name, type, value })),
  truncated: false,
});

/** Every resolver answers with many addresses, so the details are long. */
const longAnswers = Layer.succeed(DnsTransport, {
  ask: (_server, name, type) => Effect.succeed(answerOf(name, type)),
  doh: (_url, name, type) => Effect.succeed(answerOf(name, type)),
});

/**
 * Shown once a check is done. With every answer the same, the self-test
 * fails too, so the verdict is "intercepted" rather than "blocked".
 */
const checked = "checked 12 resolvers";

let current: TuiSession | undefined;

const start = async (options?: Parameters<typeof startTui>[0]) => {
  current = await startTui(options);
  return current;
};

afterEach(async () => {
  await current?.stop();
  current = undefined;
});

const check = async (s: TuiSession, done = "q  quit") => {
  await s.input.typeText(blockedName);
  s.input.pressEnter();
  return await s.until(done);
};

/** What a terminal sends for the page up and page down keys. */
const pageKeys = { down: "\u001b[6~", up: "\u001b[5~" } as const;

const page = (s: TuiSession, direction: keyof typeof pageKeys) => {
  for (let i = 0; i < pages; i += 1) {
    s.input.pressKey(pageKeys[direction]);
  }
};

/** The screen from the details pane's left border on. */
const detailsOf = (screen: string): string => {
  const rows = screen.split("\n");
  const left = rows.find((r) => r.includes("Details"))?.indexOf("╭") ?? 0;
  return rows.map((r) => r.slice(left).replaceAll(/[│\s]/gu, "")).join("");
};

describe("tui messages and keys", () => {
  test("the saved message shows on a 120 by 40 terminal", async () => {
    const s = await start({ transport: longAnswers });
    await check(s, checked);
    s.input.pressArrow("down");
    s.input.pressKey("e");
    await s.until(`saved nbchecker-${blockedName}.json`);
  });

  test("the keys stay visible on a 40 by 12 terminal", async () => {
    const s = await start(tiny);
    await s.until("ctrl+c");
    await check(s);
  });

  test("the keys stay visible on an 80 by 24 terminal", async () => {
    const s = await start(small);
    await s.until("ctrl+c");
    const screen = await check(s);
    // The table's column titles aren't drawn over by its rows.
    expect(screen).toContain("resolver");
  });
});

describe("tui scrolling", () => {
  test("help scrolls to its last line on an 80 by 24 terminal", async () => {
    const s = await start(small);
    await check(s);
    s.input.pressKey("?");
    const screen = await s.until("scroll");
    expect(screen).not.toContain("Press esc or ? to go back.");
    page(s, "down");
    await s.until("Press esc or ? to go back.");
  });

  test("the connection screen scrolls on an 80 by 24 terminal", async () => {
    const s = await start(small);
    await check(s);
    s.input.pressKey("c");
    const screen = await s.until("scroll");
    expect(screen).not.toContain("computer is blocked.");
    page(s, "down");
    expect(await s.until("computer is blocked.")).not.toContain(
      "Detected filter"
    );
    page(s, "up");
    await s.until("Detected filter");
  });

  test("long answers wrap in the details pane", async () => {
    const s = await start({ height: 60, transport: longAnswers });
    await check(s, checked);
    s.input.pressArrow("down");
    const screen = await s.until("192.0.2.12");
    expect(detailsOf(screen)).toContain(`AAAA${longAddress}`);
  });
});
