/** The text the TUI copies, and the network a result is shown with. */
import { connectionText } from "../check/connection.ts";
import type { Filter } from "../check/filters.ts";
import type { Network } from "../check/result.ts";
import { renderText } from "../report/text.ts";
import { view } from "../report/view.ts";
import { connectionCopy } from "./connection-view.ts";
import type { State } from "./state.ts";

export const dnsFilterOf = (n: Network | undefined): string =>
  (n && connectionText(n.connection)) ?? "unknown";

/** A result that couldn't be checked didn't wait for the network. */
export const networkOf = (s: State): Network | undefined =>
  s.result?.network ?? s.network;

export const copyText = (
  s: State,
  filters: readonly Filter[]
): string | undefined => {
  if (s.screen === "connection") {
    return connectionCopy(s.network, filters);
  }
  if (s.result === undefined || s.checking) {
    return;
  }
  return `DNS filter on this computer: ${dnsFilterOf(networkOf(s))}\n\n${renderText(view(s.result), false)}`;
};
