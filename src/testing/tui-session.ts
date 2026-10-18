/** Runs the interactive app in OpenTUI's virtual terminal, for screen tests. */
import { BunServices } from "@effect/platform-bun";
import type { CliRenderer } from "@opentui/core";
import {
  createTestRenderer,
  type TestRendererSetup,
} from "@opentui/core/testing";
import { sleep } from "bun";
import { Effect, Fiber, Layer } from "effect";
import { OpenRenderer, runTui } from "../tui/run.ts";
import { designComputer, designTransport } from "./design-network.ts";

const pollMs = 10;
const pollTries = 200;

interface Options {
  /** This computer's resolver. */
  readonly computer?: typeof designComputer;
  readonly height?: number;
  readonly transport?: typeof designTransport;
  readonly width?: number;
}

interface TuiSession {
  /** Resolves when the app has stopped by itself, such as after quitting. */
  readonly ended: Promise<void>;
  readonly frame: () => Promise<string>;
  readonly input: TestRendererSetup["mockInput"];
  readonly renderer: CliRenderer;
  readonly stop: () => Promise<void>;
  /** Waits until the screen contains `text`, and returns the screen. */
  readonly until: (text: string) => Promise<string>;
}

/** Starts the app on a virtual terminal, 120 by 40 unless told otherwise. */
const startTui = async ({
  computer = designComputer,
  height = 40,
  transport = designTransport,
  width = 120,
}: Options = {}): Promise<TuiSession> => {
  const setup = await createTestRenderer({ height, width });
  const fiber = runTui("0.0.0").pipe(
    Effect.provideService(OpenRenderer, () => Promise.resolve(setup.renderer)),
    Effect.provide(Layer.mergeAll(BunServices.layer, transport, computer)),
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
  const ended = Effect.runPromise(Fiber.await(fiber)).then(() => undefined);
  return {
    ended,
    frame,
    input: setup.mockInput,
    renderer: setup.renderer,
    stop,
    until,
  };
};

export type { TuiSession };
export { startTui };
