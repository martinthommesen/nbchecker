/**
 * Runs the interactive app against the example network the tests use, so
 * its look can be checked without a real network: `bun run demo`. Set
 * NBCHECKER_DEMO_SLOW=1 to see a check in progress.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { env } from "bun";
import { Effect, Layer } from "effect";
import { runTui } from "../tui/run.ts";
import {
  designComputer,
  designTransport,
  slowDesignTransport,
} from "./design-network.ts";

const transport = () => {
  const { NBCHECKER_DEMO_SLOW: slow } = env;
  if (slow === "1") {
    return slowDesignTransport;
  }
  return designTransport;
};

runTui("0.0.0-demo").pipe(
  Effect.provide(
    Layer.mergeAll(BunServices.layer, transport(), designComputer)
  ),
  BunRuntime.runMain
);
