/**
 * The nbchecker command: its flags and arguments, and whether they ask for
 * the interactive screen or for text or JSON output.
 */
import { Effect, Stdio, Stream } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { runTui } from "../tui/run.ts";
import { version } from "../version.ts";
import { checkTargets, stdinTargets } from "./batch.ts";
import { ExitStatus, exitUsage, stop } from "./exit-status.ts";

/**
 * Checks the targets given as arguments, or else those on standard input
 * when it isn't a terminal. Otherwise there is nothing to check, unless the
 * interactive screen can open: it needs a terminal and has no JSON.
 */
const handler = (input: {
  readonly json: boolean;
  readonly targets: readonly string[];
}) =>
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    if (input.targets.length > 0) {
      return yield* checkTargets(
        Stream.fromIterable(input.targets),
        input.json
      );
    }
    if (!(yield* stdio.stdinIsTerminal)) {
      return yield* checkTargets(stdinTargets, input.json);
    }
    if (!input.json && (yield* stdio.stdoutIsTerminal)) {
      return yield* runTui(version);
    }
    return yield* stop(
      exitUsage,
      "nothing to check. Pass domains or IP addresses as arguments, or one per line on standard input."
    );
  });

const command = Command.make(
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
