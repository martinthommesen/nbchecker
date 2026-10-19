/** What the controller needs from the screen and the runtime. */
import type { CliRenderer, InputRenderable } from "@opentui/core";
import type { Effect, FileSystem } from "effect";
import type { Filter } from "../check/filters.ts";
import type { detectNetwork } from "../check/network.ts";
import type { Action } from "./keys.ts";
import type { MountedScreen } from "./screen.ts";
import type { Store } from "./state.ts";

/** Checks ask the same resolvers as the network detection. */
export type Needs =
  | FileSystem.FileSystem
  | Effect.Services<typeof detectNetwork>;

/** Runs effects from key handlers: one for checks, one for the rest. */
export interface Runners {
  readonly background: (effect: Effect.Effect<void, never, Needs>) => void;
  readonly cancel: () => void;
  readonly check: (effect: Effect.Effect<void, never, Needs>) => void;
  /** Runs a network detection, interrupting the one before it. */
  readonly detect: (effect: Effect.Effect<void, never, Needs>) => void;
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
  readonly scroll: MountedScreen["scroll"];
  readonly store: Store;
}
