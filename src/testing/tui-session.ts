/** Runs the interactive app in OpenTUI's virtual terminal, for screen tests. */
import { afterEach } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import type { CliRenderer } from "@opentui/core";
import {
  createTestRenderer,
  type TestRendererSetup,
} from "@opentui/core/testing";
import { sleep } from "bun";
import { Effect, Fiber, FileSystem, Layer } from "effect";
import { OpenRenderer, runTui } from "../tui/run.ts";
import {
  blockedName,
  designComputer,
  designTransport,
} from "./design-network.ts";

/** Saving pretends to work, so tests leave no files behind. */
const noFiles = FileSystem.layerNoop({
  writeFile: () => Effect.void,
  writeFileString: () => Effect.void,
});

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
  /** Types a target, the blocked name by default, and presses enter. */
  readonly check: (target?: string) => Promise<void>;
  /** What was last copied to the clipboard. */
  readonly copied: () => string | undefined;
  /** Whether the app stops by itself, as after quitting, within `ms`. */
  readonly endsWithin: (ms: number) => Promise<boolean>;
  readonly frame: () => Promise<string>;
  readonly input: TestRendererSetup["mockInput"];
  readonly renderer: CliRenderer;
  readonly stop: () => Promise<void>;
  /** Waits until the screen contains `text`, and returns the screen. */
  readonly until: (text: string) => Promise<string>;
}

/** Keeps what the app copies, instead of sending it to the terminal. */
const catchCopies = (renderer: CliRenderer) => {
  let copied: string | undefined;
  renderer.copyToClipboardOSC52 = (text: string) => {
    copied = text;
    return true;
  };
  return () => copied;
};

const waitFor = async (
  frame: () => Promise<string>,
  text: string,
  tries = pollTries
): Promise<string> => {
  const screen = await frame();
  if (screen.includes(text)) {
    return screen;
  }
  if (tries === 0) {
    throw new Error(`the screen never showed "${text}":\n${screen}`);
  }
  await sleep(pollMs);
  return waitFor(frame, text, tries - 1);
};

/** Starts the app on a virtual terminal, 120 by 40 unless told otherwise. */
const startTui = async ({
  computer = designComputer,
  height = 40,
  transport = designTransport,
  width = 120,
}: Options = {}): Promise<TuiSession> => {
  const {
    captureCharFrame,
    mockInput: input,
    renderOnce,
    renderer,
  } = await createTestRenderer({ height, width });
  const copied = catchCopies(renderer);
  const fiber = runTui("0.0.0").pipe(
    Effect.provideService(OpenRenderer, () => Promise.resolve(renderer)),
    Effect.provide(
      Layer.mergeAll(BunServices.layer, transport, computer, noFiles)
    ),
    Effect.runFork
  );
  const frame = async () => {
    await renderOnce();
    return captureCharFrame();
  };
  const ended = Effect.runPromise(Fiber.await(fiber)).then(() => undefined);
  return {
    check: async (target = blockedName) => {
      await input.typeText(target);
      input.pressEnter();
    },
    copied,
    endsWithin: (ms) =>
      Promise.race([ended.then(() => true), sleep(ms).then(() => false)]),
    frame,
    input,
    renderer,
    stop: () => Effect.runPromise(Fiber.interrupt(fiber)).then(() => undefined),
    until: (text) => waitFor(frame, text),
  };
};

/**
 * Gives a test file a `start` for the app, and stops each test's app after
 * the test, even one that failed.
 */
const useTui = () => {
  let current: TuiSession | undefined;
  afterEach(async () => {
    await current?.stop();
    current = undefined;
  });
  return async (options?: Options): Promise<TuiSession> => {
    current = await startTui(options);
    return current;
  };
};

export type { TuiSession };
export { useTui };
