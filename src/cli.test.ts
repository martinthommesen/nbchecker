import { describe, expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { argv, sleep, spawn } from "bun";
import { Console, Effect, Exit, Layer, Stdio, Stream } from "effect";
import { cli } from "./cli.ts";
import { ExitStatus, exitUsage } from "./exit-status.ts";
import { exitIncomplete } from "./report/json.ts";
import { computer, fakeTransport } from "./testing/fake-network.ts";

const bun = argv[0] ?? "bun";
const fakeCli = `${import.meta.dir}/testing/fake-cli.ts`;

/** What a pipe holds on Linux; output beyond it was lost. */
const pipeBuffer = 65_536;
const jsonTargets = 250;
const textTargets = 2000;
const waitMs = 3000;

/** Runs nbchecker on the fake network as a real process. */
const run = (args: readonly string[], stdin = new Blob()) =>
  spawn([bun, fakeCli, ...args], { stderr: "pipe", stdin, stdout: "pipe" });

/**
 * Runs nbchecker with its output piped into a reader that reads nothing for
 * a second, so a process that exits before its output is written loses
 * what didn't fit in the pipe. The shell prints the exit status last on
 * standard error.
 */
const runPiped = async (args: readonly string[], stdin: Blob) => {
  const script = '{ "$0" "$@"; echo "$?" >&2; } | { sleep 1; cat; }';
  const proc = spawn(["sh", "-c", script, bun, fakeCli, ...args], {
    stderr: "pipe",
    stdin,
    stdout: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return { code: Number(err.trim().split("\n").at(-1)), out };
};

/** Lines that aren't targets, so they're rejected before any DNS query. */
const invalidTargets = (count: number) =>
  new Blob(Array.from({ length: count }, (_, i) => `not a name ${i}!\n`));

/** Reads chunks until they contain `text` or `deadline` passes. */
const readUntil = async (
  read: () => Promise<{ done: boolean; value?: Uint8Array | undefined }>,
  text: string,
  deadline: Promise<undefined>,
  out = ""
): Promise<string> => {
  if (out.includes(text)) {
    return out;
  }
  const chunk = await Promise.race([read(), deadline]);
  if (chunk === undefined || chunk.done) {
    return out;
  }
  const more = new TextDecoder().decode(chunk.value);
  return readUntil(read, text, deadline, out + more);
};

describe("output into a pipe", () => {
  test("JSON is complete when the exit status isn't 0", async () => {
    const targets = invalidTargets(jsonTargets);
    const { code, out } = await runPiped(["--json"], targets);
    expect(out.length).toBeGreaterThan(pipeBuffer);
    const parsed = JSON.parse(out) as { results: unknown[] };
    expect(parsed.results).toHaveLength(jsonTargets);
    expect(code).toBe(exitIncomplete);
  });

  test("text is complete when the exit status isn't 0", async () => {
    const { code, out } = await runPiped([], invalidTargets(textTargets));
    expect(out.length).toBeGreaterThan(pipeBuffer);
    expect(out).toContain(`not a name ${textTargets - 1}! is not a domain`);
    expect(code).toBe(exitIncomplete);
  });

  test("text from standard input is printed as each target is checked", async () => {
    const proc = spawn([bun, fakeCli], { stdin: "pipe", stdout: "pipe" });
    proc.stdin.write("not a name!\n");
    await proc.stdin.flush();
    const deadline = sleep(waitMs).then(() => undefined);
    const reader = proc.stdout.getReader();
    const read = () => reader.read();
    const out = await readUntil(read, "is not a domain", deadline);
    reader.releaseLock();
    await proc.stdin.end();
    expect(out).toContain("not a name! is not a domain");
    expect(await proc.exited).toBe(exitIncomplete);
  });
});

describe("usage", () => {
  test("a mistyped flag exits with 64, not the blocked status", async () => {
    const proc = run(["--jsn", "example.com"]);
    const [code, out, err] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(code).toBe(exitUsage);
    expect(`${out}${err}`).toContain("Unrecognized flag: --jsn");
  });

  test("--help still exits with 0", async () => {
    expect(await run(["--help"]).exited).toBe(0);
  });

  test("--version shows a development version without a stray v", async () => {
    const proc = run(["--version"]);
    const out = await new Response(proc.stdout).text();
    expect(out.trim()).toBe("nbchecker v0.0.0-dev");
    expect(await proc.exited).toBe(0);
  });

  test("--json without targets and a terminal for input is a usage error", async () => {
    const errors: unknown[] = [];
    const console = Object.assign(Object.create(globalThis.console), {
      error: (...args: unknown[]) => errors.push(...args),
    }) as Console.Console;
    const exit = await cli.pipe(
      Effect.provide(
        Stdio.layerTest({
          args: Effect.succeed(["--json"]),
          stdin: Stream.never,
          stdinIsTerminal: Effect.succeed(true),
        })
      ),
      Effect.provide(
        Layer.mergeAll(BunServices.layer, fakeTransport, computer)
      ),
      Effect.provideService(Console.Console, console),
      Effect.timeout(waitMs),
      Effect.exit,
      Effect.runPromise
    );
    expect(exit).toEqual(Exit.fail(new ExitStatus({ code: exitUsage })));
    expect(String(errors)).toContain("standard input");
  });
});
