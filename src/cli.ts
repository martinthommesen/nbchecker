/** The nbchecker command: the interactive screen, text or JSON output. */
import { Console, Effect, Stdio, Stream } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { check } from "./check/checker.ts";
import { connectionText } from "./check/connection.ts";
import { detectNetwork } from "./check/network.ts";
import { redirectedFilters } from "./check/result.ts";
import { ExitStatus } from "./exit-status.ts";
import { exitCode, toJson } from "./report/json.ts";
import { renderText } from "./report/text.ts";
import { view } from "./report/view.ts";
import { runTui } from "./tui/run.ts";
import { version } from "./version.ts";

const jsonIndent = 2;

/** Targets from standard input, one per line, for scripts and pipes. */
const stdinTargets = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio;
  const lines = yield* stdio.stdin.pipe(
    Stream.decodeText,
    Stream.splitLines,
    Stream.map((l) => l.trim()),
    Stream.filter((l) => l !== ""),
    Stream.runCollect
  );
  return lines;
});

/** What `dnsFilter` says when no target could be checked. */
const notChecked = "not checked";

/**
 * Checks the targets one at a time. The network is found out once, by the
 * first check that needs it and alongside that check's queries, so a run
 * with no target that can be checked needs no network.
 */
const report = (targets: readonly string[], json: boolean) =>
  Effect.gen(function* () {
    const stdio = yield* Stdio.Stdio;
    const color = yield* stdio.stdoutIsTerminal;
    const network = yield* Effect.cached(detectNetwork);
    const results = yield* Effect.forEach(
      targets,
      (target) => check(target, network),
      { concurrency: 1 }
    );
    const detected = results.find((r) => r.network !== undefined)?.network;
    let dnsFilter = notChecked;
    if (detected !== undefined) {
      dnsFilter = connectionText(detected.connection);
    }
    if (json) {
      const meta = {
        dnsFilter,
        intercepted: detected && redirectedFilters(detected),
        version,
      };
      yield* Console.log(
        JSON.stringify(toJson(meta, results), null, jsonIndent)
      );
    } else {
      if (detected !== undefined) {
        yield* Console.log(`DNS filter on this computer: ${dnsFilter}\n`);
      }
      for (const r of results) {
        yield* Console.log(renderText(view(r), color));
      }
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
      return yield* report(input.targets, input.json);
    }
    const interactive =
      !input.json &&
      (yield* stdio.stdinIsTerminal) &&
      (yield* stdio.stdoutIsTerminal);
    if (interactive) {
      return yield* runTui(version);
    }
    return yield* report(yield* stdinTargets, input.json);
  });

export const command = Command.make(
  "nbchecker",
  {
    json: Flag.Boolean("json").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Print results as JSON. Exit status: 0 nothing blocked, 1 something blocked, 2 a check was incomplete."
      )
    ),
    targets: Argument.String("target").pipe(
      Argument.withDescription(
        "Domains, URLs or IP addresses to check. Without any, nbchecker opens its interactive screen, or reads targets from standard input when that isn't a terminal."
      ),
      Argument.variadic()
    ),
  },
  handler
).pipe(
  Command.withDescription(
    "Checks whether DNS filters, such as Telenor Nettvern, Cloudflare and Quad9, block a domain or IP address."
  )
);

export const cli = Command.run(command, { version });
