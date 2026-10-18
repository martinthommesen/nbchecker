/** The one-line summaries: the verdict, progress, connection and keys. */
import type { StyledText, TextChunk } from "@opentui/core";
import type { CheckResult, Outcome } from "../check/result.ts";
import { shortList } from "../report/view.ts";
import { lines, paint, spinner } from "./paint.ts";
import type { State } from "./state.ts";
import { theme } from "./theme.ts";

const barWidth = 30;
const msPerSecond = 1000;
const truthShown = 2;
/** Your DNS and the real answer are asked alongside the filters. */
const extraResolvers = 2;

const badge = (text: string, color: string): TextChunk =>
  paint(` ${text} `, { bg: color, bold: true, fg: theme.badgeText });

const tally = (r: CheckResult) => {
  let answered = 0;
  let blocked = 0;
  for (const { outcome } of r.filters) {
    if (outcome.kind === "answered") {
      answered += 1;
      if (outcome.verdict.blocked) {
        blocked += 1;
      }
    }
  }
  return { answered, blocked };
};

const done = (o: Outcome | undefined): boolean =>
  o !== undefined && o.kind !== "pending";

/** How many of all the resolvers have answered, the real answer included. */
const progress = (r: CheckResult) => {
  let finished = r.filters.filter((f) => done(f.outcome)).length;
  if (done(r.system)) {
    finished += 1;
  }
  if (r.truthExchange !== undefined || r.truthError !== undefined) {
    finished += 1;
  }
  return { finished, total: r.filters.length + extraResolvers };
};

const systemPhrase = (r: CheckResult): TextChunk => {
  const o = r.system;
  if (o === undefined || o.kind === "pending") {
    return paint("asking…", { fg: theme.dim });
  }
  if (o.kind === "failed") {
    return paint("no answer", { fg: theme.warn });
  }
  if (o.verdict.blocked) {
    const same = r.filters.find(
      (f) =>
        f.outcome.kind === "answered" &&
        f.outcome.verdict.reason === o.verdict.reason &&
        f.filter.onlyAnswers !== undefined
    );
    let text = "blocked";
    if (same !== undefined) {
      text = `blocked (${same.filter.name})`;
    }
    return paint(text, { fg: theme.block });
  }
  if (o.verdict.missing) {
    return paint("not found", { fg: theme.dim });
  }
  return paint("resolves", { fg: theme.ok });
};

const truthPhrase = (r: CheckResult): TextChunk => {
  if (r.truthError !== undefined) {
    return paint("unavailable", { fg: theme.warn });
  }
  if (r.truthExchange === undefined) {
    return paint("asking…", { fg: theme.dim });
  }
  if (!r.exists) {
    return paint("doesn't exist", { fg: theme.dim });
  }
  return paint(shortList(r.truth, truthShown), { fg: theme.ok });
};

const verdictBadge = (r: CheckResult): TextChunk[] => {
  const { answered, blocked } = tally(r);
  const systemBlocked =
    r.system?.kind === "answered" && r.system.verdict.blocked;
  if (blocked > 0) {
    return [
      badge("BLOCKED", theme.block),
      paint("  by "),
      paint(`${blocked} of ${r.filters.length}`, {
        bold: true,
        fg: theme.block,
      }),
      paint(" filters"),
    ];
  }
  if (systemBlocked) {
    return [
      badge("BLOCKED", theme.block),
      paint("  by your DNS, but by none of the filters"),
    ];
  }
  if (r.truthError === undefined && !r.exists) {
    return [badge("DOESN'T EXIST", theme.dim), paint("  no resolver found it")];
  }
  if (answered === 0) {
    return [badge("NO ANSWER", theme.warn), paint("  no filter answered")];
  }
  return [
    badge("NOT BLOCKED", theme.ok),
    paint("  by any of "),
    paint(String(answered), { bold: true, fg: theme.ok }),
    paint(" filters"),
  ];
};

const notesLines = (r: CheckResult): TextChunk[][] =>
  r.notes.map((n) => [paint(n, { fg: theme.dim })]);

const resultSummary = (r: CheckResult, wide: boolean): StyledText => {
  if (r.lookupError !== undefined) {
    return lines([
      [badge("CAN'T CHECK", theme.warn), paint(`  ${r.lookupError}`)],
    ]);
  }
  if (!r.checked) {
    return lines([[badge("NOT CHECKED", theme.dim)], ...notesLines(r)]);
  }
  const references = [
    paint(" your DNS: ", { fg: theme.dim }),
    systemPhrase(r),
    paint("    real answer: ", { fg: theme.dim }),
    truthPhrase(r),
  ];
  if (wide) {
    return lines([
      [...verdictBadge(r), paint("   "), ...references],
      ...notesLines(r),
    ]);
  }
  return lines([verdictBadge(r), references, ...notesLines(r)]);
};

const checkingSummary = (
  r: CheckResult | undefined,
  tick: number
): StyledText => {
  const head = paint(`${spinner(tick)} Checking`, {
    bold: true,
    fg: theme.accent,
  });
  if (r === undefined || !r.checked) {
    return lines([[head]]);
  }
  const { finished, total } = progress(r);
  const filled = Math.round((finished / total) * barWidth);
  return lines([
    [
      head,
      paint("  "),
      paint("━".repeat(filled), { fg: theme.accent }),
      paint("━".repeat(barWidth - filled), { fg: theme.track }),
      paint(`  ${finished} of ${total} answered`),
      paint("    blocked so far: ", { fg: theme.dim }),
      paint(String(tally(r).blocked), { fg: theme.block }),
    ],
  ]);
};

/** A cancelled check has no verdict, only what answered before. */
const cancelledSummary = (r: CheckResult): StyledText => {
  const { answered, blocked } = tally(r);
  return lines([
    [
      badge("CANCELLED", theme.warn),
      paint(
        `  ${answered} of ${r.filters.length} filters answered first, ${blocked} of them blocking`
      ),
    ],
  ]);
};

const connectionStatus = (s: State): TextChunk => {
  const c = s.connection;
  if (c === undefined) {
    return paint(`${spinner(s.tick)} detecting…`, { fg: theme.dim });
  }
  if (c.filter !== undefined) {
    return paint(`✕ ${c.filter}`, { fg: theme.block });
  }
  if (c.network !== undefined) {
    return paint(`✓ ${c.network} DNS, no filter`, { fg: theme.ok });
  }
  if (c.error !== undefined) {
    return paint("? unknown", { fg: theme.warn });
  }
  return paint("· no filter detected", { fg: theme.dim });
};

/**
 * The line under the input: the verdict, or progress while checking. On a
 * narrow screen the reference answers go on a line of their own.
 */
export const summaryText = (s: State, wide: boolean): StyledText => {
  if (s.checking) {
    return checkingSummary(s.result, s.tick);
  }
  if (s.cancelled && s.result?.checked === true) {
    return cancelledSummary(s.result);
  }
  if (s.result === undefined) {
    return lines([
      [
        paint(
          "Type a domain, URL or IP address and press enter to see which DNS filters block it.",
          { fg: theme.dim }
        ),
      ],
    ]);
  }
  return resultSummary(s.result, wide);
};

/** The hint at the right end of the input. */
export const inputHint = (s: State): StyledText => {
  if (s.checking) {
    return lines([[paint("esc cancel", { fg: theme.dim })]]);
  }
  if (s.result?.checked !== true || s.elapsedMs === undefined) {
    return lines([[paint("enter check", { fg: theme.dim })]]);
  }
  const seconds = (s.elapsedMs / msPerSecond).toFixed(1);
  const { total } = progress(s.result);
  return lines([
    [
      paint(`A + AAAA · checked ${total} resolvers in ${seconds} s`, {
        fg: theme.dim,
      }),
    ],
  ]);
};

/** What the header says about this computer's connection. */
/** The box at the top right: which filter this computer's DNS uses. */
export const connectionBadge = (s: State): StyledText =>
  lines([[paint("your connection  ", { fg: theme.dim }), connectionStatus(s)]]);
