import { describe, expect, test } from "bun:test";
import { sleep } from "bun";
import { Effect, Layer } from "effect";
import { Dns, NetAddress } from "effect/net";
import {
  designComputer,
  slowDesignTransportBy,
} from "../testing/design-network.ts";
import {
  nettvernPlusTestPage,
  nettvernTestPage,
  testPageName,
} from "../testing/fake-network.ts";
import { useTui } from "../testing/tui-session.ts";

const slowMs = 500;
const slowTransport = slowDesignTransportBy(`${slowMs} millis`);
const endMs = 1000;
const firstDetectionMs = 800;
const laterDetectionMs = 10;
/** Longer than a test waits for the screen, so only a later lookup helps. */
const stuckMs = 5000;
const detectAgain = 4;
const settleMs = 100;

const start = useTui();

/** How one lookup of Telenor's test page goes. */
interface TestPageLookup {
  readonly answer: string;
  readonly ms: number;
}

/**
 * This computer on the design network, except that its first lookup of
 * Telenor's test page goes as `first` says and later ones as `later` says.
 * `counter.inFlight` counts the test-page lookups still running.
 */
const testPageComputer = (lookups: {
  readonly first: TestPageLookup;
  readonly later: TestPageLookup;
}) => {
  const counter = { inFlight: 0 };
  const layer = Layer.effect(
    Dns.Dns,
    Effect.gen(function* () {
      const design = yield* Dns.Dns;
      let started = 0;
      const next = () => {
        started += 1;
        if (started === 1) {
          return lookups.first;
        }
        return lookups.later;
      };
      return Dns.make({
        lookup: (host, family) => {
          if (host !== testPageName) {
            return design.lookup(host, { ...(family && { family }) });
          }
          const { answer, ms } = next();
          const address = NetAddress.ipFromStringUnsafe(answer);
          return Effect.sync(() => {
            counter.inFlight += 1;
          }).pipe(
            Effect.andThen(Effect.delay(Effect.succeed([address]), ms)),
            Effect.ensuring(
              Effect.sync(() => {
                counter.inFlight -= 1;
              })
            )
          );
        },
      });
    })
  ).pipe(Layer.provide(designComputer));
  return { counter, layer };
};

/** A first detection that never ends in time, then quick ones. */
const stuckFirstComputer = () =>
  testPageComputer({
    first: { answer: nettvernTestPage, ms: stuckMs },
    later: { answer: nettvernTestPage, ms: laterDetectionMs },
  });

describe("tui when detecting again", () => {
  test("the detection it replaces is stopped", async () => {
    const { counter, layer } = stuckFirstComputer();
    const s = await start({ computer: layer });
    await s.check();
    s.input.pressKey("c");
    for (let i = 0; i < detectAgain; i += 1) {
      s.input.pressKey("r");
    }
    await s.until("get Nettvern's answers");
    await sleep(settleMs);
    expect(counter.inFlight).toBe(0);
  });

  test("a check waiting for the stopped detection still finishes", async () => {
    const s = await start({ computer: stuckFirstComputer().layer });
    await s.check();
    s.input.pressKey("c");
    s.input.pressKey("r");
    s.input.pressEscape();
    await s.until("BLOCKED");
  });
});

describe("tui with work in flight", () => {
  test("checking again during a check shows the new check's verdict", async () => {
    const s = await start({ transport: slowTransport });
    await s.check({ until: "answered" });
    s.input.pressKey("r");
    const screen = await s.until("by 8 of 9 filters");
    expect(screen).not.toContain("CANCELLED");
  });

  test("only the latest connection detection is shown", async () => {
    // The first detection is slow and says Nettvern; later ones say Nettvern+.
    const { layer } = testPageComputer({
      first: { answer: nettvernTestPage, ms: firstDetectionMs },
      later: { answer: nettvernPlusTestPage, ms: laterDetectionMs },
    });
    const s = await start({ computer: layer });
    await s.check({ until: "BLOCKED" });
    s.input.pressKey("c");
    s.input.pressKey("r");
    await s.until("get Nettvern+'s answers");
    await sleep(firstDetectionMs);
    expect(await s.frame()).toContain("get Nettvern+'s answers");
  });

  test("the app ends when its terminal goes away", async () => {
    const s = await start();
    await s.until("Quad9");
    s.renderer.destroy();
    expect(await s.endsWithin(endMs)).toBe(true);
  });
});
