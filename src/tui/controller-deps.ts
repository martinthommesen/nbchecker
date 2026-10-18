/** What the controller needs from the screen and the runtime. */
import type { CliRenderer, InputRenderable } from "@opentui/core";
import type { Effect, FileSystem } from "effect";
import type { check } from "../check/checker.ts";
import type { detectConnection } from "../check/connection.ts";
import type { Filter } from "../check/filters.ts";
import type { Action } from "./keys.ts";
import type { Screen } from "./screen.ts";
import type { State } from "./state.ts";

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
  /** Scrolls the help or connection screen. */
  readonly scroll: Screen["scroll"];
  readonly store: Store;
}
