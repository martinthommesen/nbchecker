/** The nbchecker command: the interactive screen, text or JSON output. */
import { type FileSink, stdout } from "bun";
import { Console, Effect, Stdio, Stream } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { check } from "./check/checker.ts";
import { connectionText } from "./check/connection.ts";
import { detectNetwork } from "./check/network.ts";
import {
  type CheckResult,
  type Network,
  redirectedFilters,
} from "./check/result.ts";
import {
  ExitStatus,
  exitCode,
  exitOutput,
  exitUsage,
} from "./cli/exit-status.ts";
import { toJson } from "./report/json.ts";
import { renderText } from "./report/text.ts";
import { view } from "./report/view.ts";
import { runTui } from "./tui/run.ts";
import { version } from "./version.ts";

const jsonIndent = 2;

let out: FileSink | undefined;

/** A reader that has gone away, such as `head`, isn't worth reporting. */
const readerGone = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "EPIPE";

/**
 * Prints a line and waits until it has been written. The runtime exits
 * straight away on a nonzero status, and Console.log (or Bun.write) can
 * still be holding output for a slow reader at the other end of a pipe,
 * which then got a cut-off or garbled copy. Any other write failure, such
 * as a full disk, ends the run with its own status, so a script doesn't
 * take missing results for a clean check.
 */
const print = (text: string) =>
  Effect.tryPromise({
    catch: (error) => error,
    try: async () => {
      out ??= stdout.writer();
      out.write(`${text}\n`);
      await out.flush();
    },
  }).pipe(
    Effect.catch((error) => {
      if (readerGone(error)) {
        return Effect.void;
      }
      return Console.error(
        `nbchecker: couldn't write the results: ${error}`
      ).pipe(Effect.andThen(Effect.fail(new ExitStatus({ code: exitOutput }))));
    })
  );

/** Targets from standard input, one per line, for scripts and pipes. */
const stdinTargets = Stream.unwrap(
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

/** What `dnsFilter` says when no target could be checked. */
const notChecked = "not checked";

/**
 * Checks the targets one at a time. Text is printed as each one is
 * checked, so a long list from standard input shows progress; JSON is one
 * document at the end. The network is found out once, by the first check
 * that needs it and alongside that check's queries, so a run with no target
 * that can be checked needs no network, and the text header comes just
 * before the first such result.
 */
const report = <E, R>(targets: Stream.Stream<string, E, R>, json: boolean) =>
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
        if (detected === undefined && result.network !== undefined) {
          detected = result.network;
          if (!json) {
            const dnsFilter = connectionText(detected.connection);
            yield* print(`DNS filter on this computer: ${dnsFilter}\n`);
          }
        }
        if (!json) {
          yield* print(renderText(view(result), color));
        }
      })
    );
    if (json) {
      let dnsFilter = notChecked;
      if (detected !== undefined) {
        dnsFilter = connectionText(detected.connection);
      }
      const meta = {
        dnsFilter,
        intercepted: detected && redirectedFilters(detected),
        version,
      };
      yield* print(JSON.stringify(toJson(meta, results), null, jsonIndent));
    }
    const code = exitCode(results);
    if (code !== 0) {
      return yield* Effect.fail(new ExitStatus({ code }));
    }
  });

const handler = (input: {
  readonly json: boolean;
  readonly targets: readonly string[];
}) =>
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    if (input.targets.length > 0) {
      return yield* report(Stream.fromIterable(input.targets), input.json);
    }
    if (!(yield* stdio.stdinIsTerminal)) {
      return yield* report(stdinTargets, input.json);
    }
    if (!input.json && (yield* stdio.stdoutIsTerminal)) {
      return yield* runTui(version);
    }
    yield* Console.error(
      "nbchecker: nothing to check. Pass domains or IP addresses as arguments, or one per line on standard input."
    );
    return yield* Effect.fail(new ExitStatus({ code: exitUsage }));
  });

export const command = Command.make(
  "nbchecker",
  {
    json: Flag.Boolean("json").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Print results as JSON.")
    ),
    targets: Argument.String("target").pipe(
      Argument.withDescription(
        "Domains, URLs or IP addresses to check. Without any, nbchecker opens its interactive screen, or reads targets from standard input, one per line, when that isn't a terminal."
      ),
      Argument.variadic()
    ),
  },
  handler
).pipe(
  Command.withDescription(
    "Checks whether DNS filters, such as Telenor Nettvern, Cloudflare and Quad9, block a domain or IP address. Exit status: 0 not blocked, 1 blocked (even if some filters didn't answer), 2 incomplete (it couldn't tell), 64 usage error, 74 the results couldn't be written."
  )
);

/**
 * Runs the command. A parse error, such as a mistyped flag, exits with
 * 64 rather than effect/cli's 1, which would read as "blocked".
 */
export const cli = Command.run(command, { version }).pipe(
  Effect.catchTag("ShowHelp", (help) => {
    if (help.errors.length > 0) {
      return Effect.fail(new ExitStatus({ code: exitUsage }));
    }
    return Effect.void;
  })
);
