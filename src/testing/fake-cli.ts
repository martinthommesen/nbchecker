/**
 * The nbchecker command on the fake network the tests use, so tests can run
 * it as a real process, with real pipes, without touching the network.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { cli } from "../cli.ts";
import { computer, fakeTransport } from "./fake-network.ts";

cli.pipe(
  Effect.provide(Layer.mergeAll(BunServices.layer, fakeTransport, computer)),
  BunRuntime.runMain
);
