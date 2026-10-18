/** What each action does: checks, copying, saving and moving around. */
import { Deferred, Duration, Effect, FileSystem } from "effect";
import { check } from "../check/checker.ts";
import { detectNetwork } from "../check/network.ts";
import { Progress } from "../check/progress.ts";
import {
  cancelPending,
  type Network,
  redirectedFilters,
} from "../check/result.ts";
import { toJson } from "../report/json.ts";
import type { Controller, ControllerDeps } from "./controller-deps.ts";
import { copyText, dnsFilterOf, networkOf } from "./copy-text.ts";
import type { Action } from "./keys.ts";
import { flatRows, resultGroups } from "./rows.ts";
import type { State } from "./state.ts";

const pageStep = 5;
const jsonIndent = 2;

/** What the controller remembers between key presses. */
interface Session {
  /** Counts checks, so only the latest one updates the screen. */
  checks: number;
  /** Counts connection detections, for the same reason. */
  detections: number;
  readonly history: string[];
  lastTarget: string | undefined;
  /**
   * The network, found out once when the screen opens and again on "detect
   * again"; checks wait for it.
   */
  network: Deferred.Deferred<Network>;
  recalled: number;
  /** Networks checks wait for that no detection has found yet. */
  readonly waiting: Deferred.Deferred<Network>[];
}

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

/**
 * Checks `target`. A check that has been replaced by a newer one leaves the
 * screen alone, even when its last progress or its cancellation comes late.
 */
const checkTarget = (
  { store }: ControllerDeps,
  session: Session,
  target: string
) => {
  session.checks += 1;
  const generation = session.checks;
  const update = (patch: (s: State) => Partial<State>) =>
    Effect.sync(() => {
      if (session.checks === generation) {
        store.set(patch(store.get()));
      }
    });
  return Effect.gen(function* () {
    yield* update(() => ({
      cancelled: false,
      checking: true,
      elapsedMs: undefined,
      focus: "table",
      result: undefined,
      screen: "main",
      selected: 0,
    }));
    const { network } = session;
    const [duration, result] = yield* check(
      target,
      Deferred.await(network)
    ).pipe(
      Effect.provideService(Progress, (sofar) =>
        update(() => ({ result: sofar }))
      ),
      Effect.timed
    );
    yield* update(() => ({
      cancelled: false,
      checking: false,
      elapsedMs: Duration.toMillis(duration),
      result,
    }));
  }).pipe(
    Effect.onInterrupt(() =>
      update(({ result }) => ({
        cancelled: true,
        checking: false,
        result: result && cancelPending(result),
      }))
    )
  );
};

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
    deps.run.check(checkTarget(deps, session, target));
  };
  const recheck = () => {
    if (session.lastTarget !== undefined) {
      deps.run.check(checkTarget(deps, session, session.lastTarget));
    }
  };
  const cancel = () => {
    if (deps.store.get().checking) {
      deps.run.cancel();
      toast("cancelled");
    }
  };
  /**
   * Starts a detection and interrupts the one before it, so pressing "detect
   * again" doesn't pile up self-test queries. Checks still waiting for an
   * interrupted detection get this one's network instead.
   */
  const detect = () => {
    session.detections += 1;
    const generation = session.detections;
    const network = Deferred.makeUnsafe<Network>();
    session.network = network;
    session.waiting.push(network);
    deps.store.set({ network: undefined });
    deps.run.detect(
      Effect.gen(function* () {
        const found = yield* detectNetwork;
        if (session.detections !== generation) {
          return;
        }
        // In one step, so a newer detection can't interrupt it halfway and
        // leave a check waiting for a network that was taken off the list.
        yield* Effect.sync(() => {
          deps.store.set({ network: found });
          for (const waiting of session.waiting.splice(0)) {
            Deferred.doneUnsafe(waiting, Effect.succeed(found));
          }
        });
      })
    );
  };
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
    const network = networkOf(s);
    const meta = {
      dnsFilter: dnsFilterOf(network),
      intercepted: network && redirectedFilters(network),
      version: s.version,
    };
    const json = toJson(meta, [result]);
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
  { filters, input, store }: ControllerDeps,
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
  // Leaving the input goes back to the results, if there are any.
  const leaveInput = () => {
    const s = store.get();
    if (s.result === undefined && !s.checking) {
      return;
    }
    // Show what the results are for, not a half-typed new target.
    input.value = session.lastTarget ?? "";
    input.blur();
    store.set({ focus: "table" });
  };
  return { focusInput, leaveInput, move, recall };
};

const makeController = (deps: ControllerDeps): Controller => {
  const first = Deferred.makeUnsafe<Network>();
  const session: Session = {
    checks: 0,
    detections: 0,
    history: [],
    lastTarget: undefined,
    network: first,
    recalled: 0,
    waiting: [first],
  };
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
    scrollDown: () => deps.scroll(1, "line"),
    scrollPageDown: () => deps.scroll(1, "page"),
    scrollPageUp: () => deps.scroll(-1, "page"),
    scrollUp: () => deps.scroll(-1, "line"),
    up: () => moves.move(-1),
  };
  return {
    detect: checks.detect,
    handle: (action) => actions[action](),
    submit: checks.submit,
  };
};

export { makeController };
