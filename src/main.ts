#!/usr/bin/env bun
import { BunDns, BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { cli } from "./cli.ts";
import { layer as transport } from "./dns/transport.ts";

const live = Layer.mergeAll(
  BunServices.layer,
  BunDns.layer,
  transport().pipe(Layer.provide(FetchHttpClient.layer))
);

cli.pipe(Effect.provide(live), BunRuntime.runMain);
