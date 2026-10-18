import { afterEach, describe, expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import {
  createTestRenderer,
  type TestRendererSetup,
} from "@opentui/core/testing";
import { sleep } from "bun";
import { Effect, Fiber, Layer } from "effect";
import {
  blockedName,
  designComputer,
  designTransport,
  slowDesignTransport,
} from "../testing/design-network.ts";
import { OpenRenderer, runTui } from "./run.ts";

const width = 120;
const height = 40;
const pollMs = 10;
const pollTries = 200;

interface Session {
  readonly frame: () => Promise<string>;
  readonly input: TestRendererSetup["mockInput"];
  readonly stop: () => Promise<void>;
  /** Waits until the screen contains `text`, and returns the screen. */
  readonly until: (text: string) => Promise<string>;
}

let current: Session | undefined;

const start = async (transport = designTransport): Promise<Session> => {
  const setup = await createTestRenderer({ height, width });
  const fiber = runTui("0.0.0").pipe(
    Effect.provideService(OpenRenderer, () => Promise.resolve(setup.renderer)),
    Effect.provide(
      Layer.mergeAll(BunServices.layer, transport, designComputer)
    ),
    Effect.runFork
  );
  const frame = async () => {
    await setup.renderOnce();
    return setup.captureCharFrame();
  };
  const until = async (text: string, tries = pollTries): Promise<string> => {
    const screen = await frame();
    if (screen.includes(text)) {
      return screen;
    }
    if (tries === 0) {
      throw new Error(`the screen never showed "${text}":\n${screen}`);
    }
    await sleep(pollMs);
    return until(text, tries - 1);
  };
  const stop = () =>
    Effect.runPromise(Fiber.interrupt(fiber)).then(() => undefined);
  current = { frame, input: setup.mockInput, stop, until };
  return current;
};

const checkBlocked = async (s: Session) => {
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
    const s = await start(slowDesignTransport);
    await s.input.typeText(blockedName);
    s.input.pressEnter();
    await s.until("answered");
    s.input.pressEscape();
    const screen = await s.until("CANCELLED");
    expect(screen).not.toContain("NOT BLOCKED");
    expect(screen).toContain("cancelled");
  });

  test("leaving a new check shows the checked domain again", async () => {
    const s = await start();
    await checkBlocked(s);
    s.input.pressKey("/");
    await s.until("a domain, URL or IP address");
    s.input.pressEscape();
    const screen = await s.until(`› ${blockedName}`);
    expect(screen).not.toContain("a domain, URL or IP address");
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
