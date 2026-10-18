/**
 * Checks targets from the arguments or standard input and prints text or
 * JSON, for scripts and pipes.
 */
import { Effect, Stdio, Stream } from "effect";
import { check } from "../check/checker.ts";
import { connectionText } from "../check/connection.ts";
import { detectNetwork } from "../check/network.ts";
import {
  type CheckResult,
  type Network,
  redirectedFilters,
} from "../check/result.ts";
import { toJson } from "../report/json.ts";
import { renderText } from "../report/text.ts";
import { view } from "../report/view.ts";
import { version } from "../version.ts";
import { ExitStatus, exitCode, exitNotBlocked } from "./exit-status.ts";
import { print } from "./output.ts";

const jsonIndent = 2;

/** What `dnsFilter` says when no target could be checked. */
const notChecked = "not checked";

/** The line above the text results that says which DNS filter is in use. */
const dnsFilterLine = (n: Network) =>
  `DNS filter on this computer: ${connectionText(n.connection)}\n`;

/**
 * The --json document. `network` is undefined when no target could be
 * checked, so the network was never found out.
 */
const jsonDocument = (
  results: readonly CheckResult[],
  network: Network | undefined
) => {
  let dnsFilter = notChecked;
  if (network !== undefined) {
    dnsFilter = connectionText(network.connection);
  }
  const meta = {
    dnsFilter,
    intercepted: network && redirectedFilters(network),
    version,
  };
  return JSON.stringify(toJson(meta, results), null, jsonIndent);
};

/**
 * Prints one result as text, below the DNS filter line for `header`, the
 * network this result was the first to find out, if it was.
 */
const printText = (
  result: CheckResult,
  header: Network | undefined,
  color: boolean
) =>
  Effect.gen(function* () {
    if (header !== undefined) {
      yield* print(dnsFilterLine(header));
    }
    yield* print(renderText(view(result), color));
  });

/** Targets from standard input, one per line, for scripts and pipes. */
export const stdinTargets = Stream.unwrap(
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    return stdio.stdin.pipe(
      Stream.decodeText,
      Stream.splitLines,
      Stream.map((l) => l.trim()),
      Stream.filter((l) => l !== "")
    );
  })
);

/**
 * Checks the targets one at a time. Text is printed as each one is
 * checked, so a long list from standard input shows progress; JSON is one
 * document at the end. The network is found out once, by the first check
 * that needs it and alongside that check's queries, so a run with no target
 * that can be checked needs no network, and the text header comes just
 * before the first such result. The run then ends with the exit status the
 * results call for.
 */
export const checkTargets = <E, R>(
  targets: Stream.Stream<string, E, R>,
  json: boolean
) =>
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    const color = yield* stdio.stdoutIsTerminal;
    const network = yield* Effect.cached(detectNetwork);
    const results: CheckResult[] = [];
    let detected: Network | undefined;
    yield* Stream.runForEach(targets, (target) =>
      Effect.gen(function* () {
        const result = yield* check(target, network);
        results.push(result);
        let header: Network | undefined;
        if (detected === undefined) {
          detected = result.network;
          header = detected;
        }
        if (!json) {
          yield* printText(result, header, color);
        }
      })
    );
    if (json) {
      yield* print(jsonDocument(results, detected));
    }
    const code = exitCode(results);
    if (code !== exitNotBlocked) {
      return yield* Effect.fail(new ExitStatus({ code }));
    }
  });
