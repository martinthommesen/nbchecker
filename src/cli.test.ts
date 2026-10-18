import { describe, expect, test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Console, Effect, Exit, Layer, Stdio } from "effect";
import { Command } from "effect/cli";
import { Dns } from "effect/net";
import { CheckerOptions } from "./check/checker.ts";
import { command } from "./cli.ts";
import { DnsTransport } from "./dns/transport.ts";
import { ExitStatus } from "./exit-status.ts";
import { exitIncomplete } from "./report/json.ts";
import {
  computer,
  fakeFilters,
  fakeTransport,
  redirectingTransport,
} from "./testing/fake-network.ts";
import { truthUrl } from "./testing/run-check.ts";

interface Ran {
  readonly code: number;
  readonly out: string;
  /** The names asked over the network, by any resolver. */
  readonly queries: readonly string[];
}

const codeOf = (exit: Exit.Exit<unknown, unknown>): number => {
  if (Exit.isSuccess(exit)) {
    return 0;
  }
  const error = exit.cause.reasons
    .flatMap((r) => {
      if (r._tag === "Fail") {
        return [r.error];
      }
      return [];
    })
    .find((e) => e instanceof ExitStatus);
  return error?.code ?? -1;
};

/** Runs nbchecker in this process on the fake network. */
const run = async (
  args: readonly string[],
  transport: Layer.Layer<DnsTransport> = fakeTransport
): Promise<Ran> => {
  const out: string[] = [];
  const queries: string[] = [];
  const recording = Layer.effect(
    DnsTransport,
    Effect.gen(function* () {
      const t = yield* DnsTransport;
      return {
        ask: (server, name, type) => {
          queries.push(name);
          return t.ask(server, name, type);
        },
        doh: (url, name, type) => {
          queries.push(name);
          return t.doh(url, name, type);
        },
      } satisfies typeof t;
    })
  ).pipe(Layer.provide(transport));
  const dns = Layer.effect(
    Dns.Dns,
    Effect.gen(function* () {
      const d = yield* Dns.Dns;
      return Dns.make({
        lookup: (name) => {
          queries.push(name);
          return d.lookup(name);
        },
      });
    })
  ).pipe(Layer.provide(computer));
  const captured: Console.Console = Object.assign(Object.create(console), {
    log: (...parts: readonly unknown[]) => out.push(parts.join(" ")),
  });
  const exit = await Command.runWith(command, { version: "0.0.0" })(args).pipe(
    Effect.provideService(CheckerOptions, {
      filters: fakeFilters,
      truthUrls: [truthUrl],
    }),
    Effect.provideService(Console.Console, captured),
    Effect.provide(Stdio.layerTest({})),
    Effect.provide(Layer.mergeAll(BunServices.layer, recording, dns)),
    Effect.exit,
    Effect.runPromise
  );
  return { code: codeOf(exit), out: out.join("\n"), queries };
};

describe("cli: the network is found out once per run", () => {
  test("a run with no target that can be checked asks nothing", async () => {
    const r = await run(["--json", "not a name!"]);
    expect(r.queries).toEqual([]);
    expect(JSON.parse(r.out)).toMatchObject({ dnsFilter: "not checked" });
    expect(JSON.parse(r.out)).not.toHaveProperty("intercepted");
    const text = await run(["not a name!"]);
    expect(text.queries).toEqual([]);
    expect(text.out).not.toContain("DNS filter on this computer");
  });

  test("the self-test and test page are asked once for many targets", async () => {
    const r = await run(["good.example", "bad.example", "mail.example"]);
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
    const r = await run(["--json", "good.example"]);
    expect(JSON.parse(r.out)).toMatchObject({ intercepted: [] });
    expect(r.code).toBe(0);
  });

  test("a redirecting network warns, lists the filters and exits 2", async () => {
    const r = await run(["--json", "good.example"], redirectingTransport());
    expect(JSON.parse(r.out)).toMatchObject({
      intercepted: ["Security filter", "Family filter"],
      results: [{ status: "intercepted" }],
    });
    expect(r.code).toBe(exitIncomplete);
    const text = await run(["good.example"], redirectingTransport());
    expect(text.out).toContain("DNS on this network seems to be intercepted");
  });
});
