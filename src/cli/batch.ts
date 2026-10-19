/**
 * Checks targets from the arguments or standard input and prints text or
 * JSON, for scripts and pipes.
 */
import { Effect, Stdio, Stream } from "effect";
import { check } from "../check/checker.ts";
import { connectionText } from "../check/connection.ts";
import { detectNetwork } from "../check/network.ts";
import type { CheckResult, Network } from "../check/result.ts";
import { jsonMeta, jsonText } from "../report/json.ts";
import { dnsFilterLine, renderText } from "../report/text.ts";
import { view } from "../report/view.ts";
import { version } from "../version.ts";
import { ExitStatus, exitCode, exitNotBlocked } from "./exit-status.ts";
import { print } from "./output.ts";

/**
 * What `dnsFilter` says when no target could be checked, so the network was
 * never found out.
 */
const notChecked = "not checked";

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
      yield* print(`${dnsFilterLine(connectionText(header.connection))}\n`);
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
      yield* print(jsonText(jsonMeta(detected, notChecked, version), results));
    }
    const code = exitCode(results);
    if (code !== exitNotBlocked) {
      return yield* Effect.fail(new ExitStatus({ code }));
    }
  });
