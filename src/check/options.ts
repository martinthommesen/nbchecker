/** Which filters and unfiltered resolvers a check asks. */
import { Context } from "effect";
import { type Filter, filters, truthResolvers } from "./filters.ts";

export interface CheckerOptions {
  readonly filters: readonly Filter[];
  readonly truthUrls: readonly string[];
}

/** Which filters and resolvers to ask; tests swap them for fakes. */
export const CheckerOptions = Context.Reference<CheckerOptions>(
  "nbchecker/CheckerOptions",
  { defaultValue: () => ({ filters, truthUrls: truthResolvers }) }
);
