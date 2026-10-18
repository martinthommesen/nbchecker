import { afterEach, describe, expect, test } from "bun:test";
import { sleep } from "bun";
import { Effect, Layer, Result } from "effect";
import { Dns } from "effect/net";
import {
  blockedName,
  slowDesignTransportBy,
} from "../testing/design-network.ts";
import { startTui, type TuiSession } from "../testing/tui-session.ts";

const slowMs = 500;
const slowTransport = slowDesignTransportBy(`${slowMs} millis`);
const endMs = 1000;
const firstDetectionMs = 800;
const laterDetectionMs = 10;
const detectAgain = 4;
const settleMs = 100;

let current: TuiSession | undefined;

afterEach(async () => {
  await current?.stop();
  current = undefined;
});

const zone = (testPageAnswer: string) =>
  Result.getOrThrow(
    Dns.makeStatic({
      hosts: {
        [blockedName]: ["0.0.0.0"],
        "nettvern.telenor.net": [testPageAnswer],
      },
    })
  );

/**
 * A resolver whose first test-page lookup is slow and says Nettvern, and
 * whose later ones are quick and say Nettvern+.
 */
const changingComputer = Layer.sync(Dns.Dns, () => {
  const first = zone("148.123.15.38");
  const later = zone("148.123.15.1");
  let lookups = 0;
  return Dns.make({
    lookup: (host, family) => {
      if (host !== "nettvern.telenor.net") {
        return first.lookup(host, { ...(family && { family }) });
      }
      lookups += 1;
      if (lookups === 1) {
        return Effect.delay(first.lookup(host), firstDetectionMs);
      }
      return Effect.delay(later.lookup(host), laterDetectionMs);
    },
  });
});

/** Longer than a test waits for the screen, so only a later lookup helps. */
const stuckMs = 5000;

/**
 * A resolver whose first test-page lookup takes `stuckMs` and whose later
 * ones are quick. `inFlight` counts the test-page lookups still running.
 */
const stuckFirstComputer = () => {
  const counter = { inFlight: 0 };
  const layer = Layer.sync(Dns.Dns, () => {
    const zoned = zone("148.123.15.38");
    let lookups = 0;
    return Dns.make({
      lookup: (host, family) => {
        if (host !== "nettvern.telenor.net") {
          return zoned.lookup(host, { ...(family && { family }) });
        }
        lookups += 1;
        let delay = laterDetectionMs;
        if (lookups === 1) {
          delay = stuckMs;
        }
        return Effect.sync(() => {
          counter.inFlight += 1;
        }).pipe(
          Effect.andThen(Effect.delay(zoned.lookup(host), delay)),
          Effect.ensuring(
            Effect.sync(() => {
              counter.inFlight -= 1;
            })
          )
        );
      },
    });
  });
  return { counter, layer };
};

describe("tui when detecting again", () => {
  test("the detection it replaces is stopped", async () => {
    const { counter, layer } = stuckFirstComputer();
    const s = await startTui({ computer: layer });
    current = s;
    await s.input.typeText(blockedName);
    s.input.pressEnter();
    s.input.pressKey("c");
    for (let i = 0; i < detectAgain; i += 1) {
      s.input.pressKey("r");
    }
    await s.until("get Nettvern's answers");
    await sleep(settleMs);
    expect(counter.inFlight).toBe(0);
  });

  test("a check waiting for the stopped detection still finishes", async () => {
    const { layer } = stuckFirstComputer();
    const s = await startTui({ computer: layer });
    current = s;
    await s.input.typeText(blockedName);
    s.input.pressEnter();
    s.input.pressKey("c");
    s.input.pressKey("r");
    s.input.pressEscape();
    await s.until("BLOCKED");
  });
});

describe("tui with work in flight", () => {
  test("checking again during a check shows the new check's verdict", async () => {
    const s = await startTui({ transport: slowTransport });
    current = s;
    await s.input.typeText(blockedName);
    s.input.pressEnter();
    await s.until("answered");
    s.input.pressKey("r");
    const screen = await s.until("by 8 of 9 filters");
    expect(screen).not.toContain("CANCELLED");
  });

  test("only the latest connection detection is shown", async () => {
    const s = await startTui({ computer: changingComputer });
    current = s;
    await s.input.typeText(blockedName);
    s.input.pressEnter();
    await s.until("BLOCKED");
    s.input.pressKey("c");
    s.input.pressKey("r");
    await s.until("get Nettvern+'s answers");
    await sleep(firstDetectionMs);
    expect(await s.frame()).toContain("get Nettvern+'s answers");
  });

  test("the app ends when its terminal goes away", async () => {
    const s = await startTui();
    current = s;
    await s.until("Quad9");
    s.renderer.destroy();
    const ended = await Promise.race([
      s.ended.then(() => true),
      sleep(endMs).then(() => false),
    ]);
    expect(ended).toBe(true);
  });
});
