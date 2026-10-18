/** Runs the interactive screen until the user quits. */
import {
  type CliRenderer,
  createCliRenderer,
  type KeyEvent,
} from "@opentui/core";
import {
  Context,
  Deferred,
  Effect,
  FiberHandle,
  FiberSet,
  Schedule,
} from "effect";
import { CheckerOptions } from "../check/checker.ts";
import { makeController, type Needs, type Store } from "./controller.ts";
import { actionFor } from "./keys.ts";
import { mountScreen } from "./screen.ts";
import { initialState, type State } from "./state.ts";

/** Opens the terminal; tests swap in a virtual one. */
const OpenRenderer = Context.Reference<() => Promise<CliRenderer>>(
  "nbchecker/OpenRenderer",
  { defaultValue: () => () => createCliRenderer({ exitOnCtrlC: false }) }
);

const openRenderer = Effect.acquireRelease(
  Effect.flatMap(OpenRenderer, (open) => Effect.promise(open)),
  (renderer) =>
    Effect.promise(async () => {
      renderer.destroy();
      await renderer.closed;
    })
);

const makeStore = (initial: State, draw: (s: State) => void): Store => {
  let state = initial;
  return {
    get: () => state,
    set: (patch) => {
      state = { ...state, ...patch };
      draw(state);
    },
  };
};

/** Moves the spinners while anything is still being asked. */
const ticker = (store: Store) =>
  Effect.sync(() => {
    const s = store.get();
    if (s.checking || s.network === undefined) {
      store.set({ tick: s.tick + 1 });
    }
  }).pipe(Effect.repeat(Schedule.spaced("80 millis")), Effect.asVoid);

/** Shows the screen, checks `first` straight away if given, and waits. */
const runTui = (version: string, first?: string) =>
  Effect.gen(function* () {
    const renderer = yield* openRenderer;
    const { filters } = yield* CheckerOptions;
    const screen = mountScreen(renderer, filters);
    const checks = yield* FiberHandle.make();
    const runCheck = yield* FiberHandle.runtime(checks)<Needs>();
    const runBackground = yield* FiberSet.makeRuntime<Needs>();
    const quit = yield* Deferred.make<void>();
    const store = makeStore(initialState(version), screen.draw);
    const controller = makeController({
      filters,
      input: screen.input,
      quit: () => Deferred.doneUnsafe(quit, Effect.void),
      renderer,
      run: {
        background: (effect) => runBackground(effect),
        cancel: () => runBackground(FiberHandle.clear(checks)),
        check: (effect) => runCheck(effect),
      },
      store,
    });
    screen.input.on("enter", () => {
      const target = screen.input.value.trim();
      if (target !== "") {
        controller.submit(target);
      }
    });
    renderer.keyInput.on("keypress", (key: KeyEvent) => {
      const action = actionFor(store.get(), key);
      if (action !== undefined) {
        // The key did its job; don't also type it into the input.
        key.preventDefault();
        controller.handle(action);
      }
    });
    renderer.on("resize", () => screen.draw(store.get()));
    screen.input.focus();
    store.set({});
    runBackground(ticker(store));
    controller.detect();
    if (first !== undefined) {
      controller.submit(first);
    }
    yield* Deferred.await(quit);
  }).pipe(Effect.scoped);

export { OpenRenderer, runTui };
