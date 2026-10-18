import { describe, expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { argv, env, file, sleep, spawn, spawnSync } from "bun";
import { Console, Effect, Exit, Layer, Stdio, Stream } from "effect";
import {
  computer,
  fakeFilters,
  fakeTransport,
} from "../testing/fake-network.ts";
import { cli } from "./command.ts";
import {
  ExitStatus,
  exitIncomplete,
  exitOutput,
  exitUsage,
} from "./exit-status.ts";

const bun = argv[0] ?? "bun";
const fakeCli = `${import.meta.dir}/../testing/fake-cli.ts`;

/** What a pipe holds on Linux; output beyond it was lost. */
const pipeBuffer = 65_536;
const jsonTargets = 250;
const textTargets = 2000;
const waitMs = 3000;
/** How the fake network says it was asked a name. */
const asked = "asked ";

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

/** Linux's always-full device; macOS has none. */
const hasDevFull = spawnSync(["test", "-c", "/dev/full"]).exitCode === 0;

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

describe("output that can't be written", () => {
  test.skipIf(!hasDevFull)(
    "a full disk exits with 74 and says why",
    async () => {
      const proc = spawn([bun, fakeCli], {
        stderr: "pipe",
        stdin: invalidTargets(1),
        stdout: file("/dev/full"),
      });
      const err = await new Response(proc.stderr).text();
      expect(await proc.exited).toBe(exitOutput);
      expect(err).toContain("couldn't write the results");
    }
  );

  test("a reader that stops early isn't an output error", async () => {
    const script = '{ "$0" "$@"; echo "$?" >&2; } | head -c 1 > /dev/null';
    const proc = spawn(["sh", "-c", script, bun, fakeCli], {
      stderr: "pipe",
      stdin: invalidTargets(textTargets),
      stdout: "pipe",
    });
    const err = await new Response(proc.stderr).text();
    await proc.exited;
    expect(err).not.toContain("couldn't write the results");
    expect(Number(err.trim().split("\n").at(-1))).toBe(exitIncomplete);
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

describe("connection detection", () => {
  test("is skipped when no target can be checked", async () => {
    const proc = run(["--json", "not a name!"]);
    const out = await new Response(proc.stdout).text();
    const parsed = JSON.parse(out) as { dnsFilter: string };
    expect(parsed.dnsFilter).toBe("not checked");
    const text = await new Response(run(["not a name!"]).stdout).text();
    expect(text).not.toContain("DNS filter on this computer");
  });

  test("runs once a target can be checked", async () => {
    const proc = run(["--json", "not a name!", "good.example"]);
    const out = await new Response(proc.stdout).text();
    const parsed = JSON.parse(out) as { dnsFilter: string };
    expect(parsed.dnsFilter).toBe("Telenor Nettvern+");
    const text = await new Response(run(["good.example"]).stdout).text();
    expect(text).toStartWith("DNS filter on this computer: Telenor Nettvern+");
  });
});

/**
 * Runs nbchecker as a real process and returns its output, its exit status
 * and the names it asked over the network.
 */
const runRecorded = async (args: readonly string[], network = "honest") => {
  const proc = spawn([bun, fakeCli, ...args], {
    env: {
      ...env,
      ...Object.fromEntries([
        ["NBCHECKER_FAKE_NETWORK", network],
        ["NBCHECKER_FAKE_QUERIES", "1"],
      ]),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const queries = err
    .split("\n")
    .filter((l) => l.startsWith(asked))
    .map((l) => l.slice(asked.length));
  return { code, out, queries };
};

describe("cli: the network is found out once per run", () => {
  test("a run with no target that can be checked asks nothing", async () => {
    const r = await runRecorded(["--json", "not a name!"]);
    expect(r.queries).toEqual([]);
    expect(JSON.parse(r.out)).toMatchObject({ dnsFilter: "not checked" });
    expect(JSON.parse(r.out)).not.toHaveProperty("intercepted");
    const text = await runRecorded(["not a name!"]);
    expect(text.queries).toEqual([]);
    expect(text.out).not.toContain("DNS filter on this computer");
  });

  test("the self-test and test page are asked once for many targets", async () => {
    const r = await runRecorded([
      "good.example",
      "bad.example",
      "mail.example",
    ]);
    expect(r.out).toStartWith("DNS filter on this computer: Telenor Nettvern+");
    const canaries = r.queries.filter((q) => q === "canary.example");
    // An A and an AAAA query to each of the fake filters' servers.
    const servers = fakeFilters.flatMap((f) => f.servers);
    expect(canaries).toHaveLength(servers.length * 2);
    expect(r.queries.filter((q) => q === "nettvern.telenor.net")).toHaveLength(
      1
    );
  });
});

describe("cli: intercepted DNS", () => {
  test("an honest network lists no filter as intercepted", async () => {
    const r = await runRecorded(["--json", "good.example"]);
    expect(JSON.parse(r.out)).toMatchObject({ intercepted: [] });
    expect(r.code).toBe(0);
  });

  test("a redirecting network warns, lists the filters and exits 2", async () => {
    const r = await runRecorded(["--json", "good.example"], "redirecting");
    expect(JSON.parse(r.out)).toMatchObject({
      intercepted: ["Security filter", "Family filter"],
      results: [{ status: "intercepted" }],
    });
    expect(r.code).toBe(exitIncomplete);
    const text = await runRecorded(["good.example"], "redirecting");
    expect(text.out).toContain("DNS on this network seems to be intercepted");
  });
});
