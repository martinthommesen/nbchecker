/** The text the TUI copies, and the JSON it exports. */
import { dnsFilterOf } from "../check/connection.ts";
import type { Filter } from "../check/filters.ts";
import type { CheckResult, Network } from "../check/result.ts";
import { jsonMeta, jsonText } from "../report/json.ts";
import { dnsFilterLine, renderText } from "../report/text.ts";
import { view } from "../report/view.ts";
import { connectionCopy } from "./connection-text.ts";
import type { State } from "./state.ts";

/** What the screen calls the DNS filter while the network is being detected. */
const whileDetecting = "unknown";

/** A result that couldn't be checked didn't wait for the network. */
const networkOf = (s: State): Network | undefined =>
  s.result?.network ?? s.network;

/** The screen as text, or undefined when there is nothing to copy yet. */
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
  const dnsFilter = dnsFilterOf(networkOf(s)?.connection, whileDetecting);
  return `${dnsFilterLine(dnsFilter)}\n\n${renderText(view(s.result), false)}`;
};

/** `result` as the JSON document, with the network it was checked on. */
export const exportedJson = (s: State, result: CheckResult): string =>
  jsonText(jsonMeta(networkOf(s), whileDetecting, s.version), [result]);
