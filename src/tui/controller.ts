/** What each action does: checks, copying, saving and moving around. */
import type { CliRenderer, InputRenderable } from "@opentui/core";
import { Duration, Effect, FileSystem } from "effect";
import { check } from "../check/checker.ts";
import { connectionText, detectConnection } from "../check/connection.ts";
import type { Filter } from "../check/filters.ts";
import { Progress } from "../check/progress.ts";
import { cancelPending } from "../check/result.ts";
import { toJson } from "../report/json.ts";
import { renderText } from "../report/text.ts";
import { view } from "../report/view.ts";
import { connectionCopy } from "./connection-view.ts";
import type { Action } from "./keys.ts";
import { flatRows, resultGroups } from "./rows.ts";
import type { State } from "./state.ts";

const pageStep = 5;
const jsonIndent = 2;

/** What the controller remembers between key presses. */
interface Session {
  readonly history: string[];
  lastTarget: string | undefined;
  recalled: number;
}

const dnsFilterOf = (s: State): string =>
  (s.connection && connectionText(s.connection)) ?? "unknown";

const copyText = (s: State, filters: readonly Filter[]): string | undefined => {
  if (s.screen === "connection") {
    return connectionCopy(s.connection, filters);
  }
  if (s.result === undefined || s.checking) {
    return;
  }
  return `DNS filter on this computer: ${dnsFilterOf(s)}\n\n${renderText(view(s.result), false)}`;
};

const toaster =
  ({ run, store }: ControllerDeps) =>
  (message: string) =>
    run.background(
      Effect.gen(function* () {
        store.set({ toast: message });
        yield* Effect.sleep("3 seconds");
        if (store.get().toast === message) {
          store.set({ toast: undefined });
        }
      })
    );

const checkTarget = ({ store }: ControllerDeps, target: string) =>
  Effect.gen(function* () {
    store.set({
      cancelled: false,
      checking: true,
      elapsedMs: undefined,
      focus: "table",
      result: undefined,
      screen: "main",
      selected: 0,
    });
    const [duration, result] = yield* check(target).pipe(
      Effect.provideService(Progress, (sofar) =>
        Effect.sync(() => store.set({ result: sofar }))
      ),
      Effect.timed
    );
    store.set({
      checking: false,
      elapsedMs: Duration.toMillis(duration),
      result,
    });
  }).pipe(
    Effect.onInterrupt(() =>
      Effect.sync(() => {
        const { result } = store.get();
        store.set({
          cancelled: true,
          checking: false,
          result: result && cancelPending(result),
        });
      })
    )
  );

const checkActions = (
  deps: ControllerDeps,
  session: Session,
  toast: (m: string) => void
) => {
  const submit = (target: string) => {
    if (session.history.at(-1) !== target) {
      session.history.push(target);
    }
    session.recalled = session.history.length;
    session.lastTarget = target;
    deps.input.value = target;
    deps.input.blur();
    deps.run.check(checkTarget(deps, target));
  };
  const recheck = () => {
    if (session.lastTarget !== undefined) {
      deps.run.check(checkTarget(deps, session.lastTarget));
    }
  };
  const cancel = () => {
    if (deps.store.get().checking) {
      deps.run.cancel();
      toast("cancelled");
    }
  };
  const detect = () =>
    deps.run.background(
      Effect.gen(function* () {
        deps.store.set({ connection: undefined });
        deps.store.set({ connection: yield* detectConnection });
      })
    );
  return { cancel, detect, recheck, submit };
};

const outputActions = (deps: ControllerDeps, toast: (m: string) => void) => {
  const exportJson = () => {
    const s = deps.store.get();
    const { result } = s;
    if (result === undefined || s.checking) {
      return toast("nothing to export yet");
    }
    const path = `nbchecker-${result.host}.json`;
    const json = toJson({ dnsFilter: dnsFilterOf(s), version: s.version }, [
      result,
    ]);
    deps.run.background(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(
          path,
          `${JSON.stringify(json, null, jsonIndent)}\n`
        );
        toast(`saved ${path}`);
      }).pipe(
        Effect.catch((e) =>
          Effect.sync(() => toast(`couldn't save: ${e.message}`))
        )
      )
    );
  };
  const copy = () => {
    const text = copyText(deps.store.get(), deps.filters);
    if (text === undefined) {
      return toast("nothing to copy yet");
    }
    if (deps.renderer.copyToClipboardOSC52(text)) {
      return toast("copied");
    }
    toast("this terminal doesn't support copying");
  };
  return { copy, exportJson };
};

const moveActions = (
  { filters, input, quit, store }: ControllerDeps,
  session: Session
) => {
  const move = (delta: number) => {
    const s = store.get();
    let count = filters.length;
    if (s.result !== undefined) {
      count = flatRows(resultGroups(s.result)).length;
    }
    const selected = Math.min(
      Math.max(s.selected + delta, 0),
      Math.max(count - 1, 0)
    );
    store.set({ selected });
  };
  const recall = (step: number) => {
    session.recalled = Math.min(
      Math.max(session.recalled + step, 0),
      session.history.length
    );
    input.value = session.history[session.recalled] ?? "";
  };
  const focusInput = () => {
    store.set({ focus: "input", screen: "main" });
    input.value = "";
    input.focus();
  };
  // Leaving the input goes back to the results, or quits if there are none.
  const leaveInput = () => {
    const s = store.get();
    if (s.result === undefined && !s.checking) {
      return quit();
    }
    // Show what the results are for, not a half-typed new target.
    input.value = session.lastTarget ?? "";
    input.blur();
    store.set({ focus: "table" });
  };
  return { focusInput, leaveInput, move, recall };
};

const makeController = (deps: ControllerDeps): Controller => {
  const session: Session = { history: [], lastTarget: undefined, recalled: 0 };
  const toast = toaster(deps);
  const checks = checkActions(deps, session, toast);
  const output = outputActions(deps, toast);
  const moves = moveActions(deps, session);
  const show = (screen: State["screen"]) => () => deps.store.set({ screen });
  const actions: Record<Action, () => void> = {
    back: show("main"),
    cancel: checks.cancel,
    connection: show("connection"),
    copy: output.copy,
    detect: checks.detect,
    down: () => moves.move(1),
    export: output.exportJson,
    help: show("help"),
    historyDown: () => moves.recall(1),
    historyUp: () => moves.recall(-1),
    leaveInput: moves.leaveInput,
    newCheck: moves.focusInput,
    pageDown: () => moves.move(pageStep),
    pageUp: () => moves.move(-pageStep),
    quit: deps.quit,
    recheck: checks.recheck,
    up: () => moves.move(-1),
  };
  return {
    detect: checks.detect,
    handle: (action) => actions[action](),
    submit: checks.submit,
  };
};

export interface Store {
  readonly get: () => State;
  readonly set: (patch: Partial<State>) => void;
}

export type Needs =
  | FileSystem.FileSystem
  | Effect.Services<ReturnType<typeof check>>
  | Effect.Services<typeof detectConnection>;

/** Runs effects from key handlers: one for checks, one for the rest. */
export interface Runners {
  readonly background: (effect: Effect.Effect<void, never, Needs>) => void;
  readonly cancel: () => void;
  readonly check: (effect: Effect.Effect<void, never, Needs>) => void;
}

export interface Controller {
  readonly detect: () => void;
  readonly handle: (action: Action) => void;
  readonly submit: (target: string) => void;
}

export interface ControllerDeps {
  readonly filters: readonly Filter[];
  readonly input: InputRenderable;
  readonly quit: () => void;
  readonly renderer: CliRenderer;
  readonly run: Runners;
  readonly store: Store;
}

export { makeController };
