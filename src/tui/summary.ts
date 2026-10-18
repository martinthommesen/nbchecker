/** The one-line summaries: the verdict, progress, connection and keys. */
import type { StyledText, TextChunk } from "@opentui/core";
import { seemsIntercepted, trustedFilters } from "../check/evidence.ts";
import {
  type CheckResult,
  nameExists,
  realAddresses,
  realAnswerKnown,
  realAnswerUnavailable,
  settled,
} from "../check/result.ts";
import { type Status, statusOf } from "../report/status.ts";
import { shortList } from "../report/view.ts";
import { lines, paint, spinner } from "./paint.ts";
import type { State } from "./state.ts";
import { theme } from "./theme.ts";

const barWidth = 30;
const msPerSecond = 1000;
const realAddressesShown = 2;
/** Your DNS and the real answer are asked alongside the filters. */
const extraResolvers = 2;

const badge = (text: string, color: string): TextChunk =>
  paint(` ${text} `, { bg: color, bold: true, fg: theme.badgeText });

/** How many of all the resolvers have answered, the real answer included. */
const progress = (r: CheckResult) => {
  let finished = r.filters.filter((f) => settled(f.outcome)).length;
  if (settled(r.system)) {
    finished += 1;
  }
  if (settled(r.realAnswer)) {
    finished += 1;
  }
  return { finished, total: r.filters.length + extraResolvers };
};

const systemPhrase = (r: CheckResult): TextChunk => {
  const o = r.system;
  if (o.kind === "pending") {
    return paint("asking…", { fg: theme.dim });
  }
  if (o.kind === "failed" || o.kind === "cancelled") {
    return paint("no answer", { fg: theme.warn });
  }
  if (o.verdict.blocked) {
    const same = trustedFilters(r).find(
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
  if (o.verdict.inspected) {
    return paint("inspected", { fg: theme.warn });
  }
  if (o.verdict.missing) {
    return paint("no address", { fg: theme.dim });
  }
  return paint("resolves", { fg: theme.ok });
};

const realAnswerPhrase = (r: CheckResult): TextChunk => {
  if (realAnswerUnavailable(r)) {
    return paint("unavailable", { fg: theme.warn });
  }
  if (!realAnswerKnown(r)) {
    return paint("asking…", { fg: theme.dim });
  }
  if (!nameExists(r)) {
    return paint("doesn't exist", { fg: theme.dim });
  }
  const addresses = realAddresses(r);
  if (addresses.length === 0) {
    return paint("no addresses", { fg: theme.ok });
  }
  return paint(shortList(addresses, realAddressesShown), { fg: theme.ok });
};

const counted = (n: number, of: number, color: string): TextChunk =>
  paint(`${n} of ${of}`, { bold: true, fg: color });

const inspectedBadge = (status: Status): TextChunk[] => {
  if (status.inspected === 0) {
    return [
      badge("INSPECTED", theme.warn),
      paint("  your DNS sends it through Cisco's proxy, not blocked"),
    ];
  }
  return [
    badge("INSPECTED", theme.warn),
    paint("  "),
    counted(status.inspected, status.answered, theme.warn),
    paint(" filters send it through Cisco's proxy"),
  ];
};

/** The verdict's badge and the words after it. */
const verdictBadge = (status: Status): TextChunk[] => {
  switch (status.kind) {
    case "blocked":
      return [
        badge("BLOCKED", theme.block),
        paint("  by "),
        counted(status.blocked, status.answered, theme.block),
        paint(" filters"),
      ];
    case "blocked-here":
      return [
        badge("BLOCKED", theme.block),
        paint("  by your DNS, but by none of the filters"),
      ];
    case "cant-tell":
      return [
        badge("COULDN'T TELL", theme.warn),
        paint("  the real answer is unavailable"),
      ];
    case "inspected":
      return inspectedBadge(status);
    case "intercepted":
      return [
        badge("INTERCEPTED?", theme.warn),
        paint("  DNS here seems redirected; results can't be trusted"),
      ];
    case "local-only":
      return [
        badge("ONLY HERE", theme.dim),
        paint("  only resolves on this computer (private or split DNS)"),
      ];
    case "missing":
      return [
        badge("DOESN'T EXIST", theme.dim),
        paint("  the real answer says so"),
      ];
    case "no-answer":
      return [badge("NO ANSWER", theme.warn), paint("  no filter answered")];
    default:
      return [
        badge("NOT BLOCKED", theme.ok),
        paint("  by any of "),
        paint(String(status.answered), { bold: true, fg: theme.ok }),
        paint(" filters"),
      ];
  }
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
    realAnswerPhrase(r),
  ];
  const verdict = verdictBadge(statusOf(r));
  if (wide) {
    return lines([[...verdict, paint("   "), ...references], ...notesLines(r)]);
  }
  return lines([verdict, references, ...notesLines(r)]);
};

const checkingSummary = (
  r: CheckResult | undefined,
  tick: number,
  wide: boolean
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
  const bar = [
    head,
    paint("  "),
    paint("━".repeat(filled), { fg: theme.accent }),
    paint("━".repeat(barWidth - filled), { fg: theme.track }),
    paint(`  ${finished} of ${total} answered`),
  ];
  const blocked = [
    paint("blocked so far: ", { fg: theme.dim }),
    paint(String(statusOf(r).blocked), { fg: theme.block }),
  ];
  if (wide) {
    return lines([[...bar, paint("    "), ...blocked]]);
  }
  return lines([bar, blocked]);
};

/** A cancelled check has no verdict, only what answered before. */
const cancelledSummary = (r: CheckResult): StyledText => {
  const { answered, blocked, total } = statusOf(r);
  return lines([
    [
      badge("CANCELLED", theme.warn),
      paint(
        `  ${answered} of ${total} filters answered first, ${blocked} of them blocking`
      ),
    ],
  ]);
};

const connectionStatus = (s: State): TextChunk => {
  const c = s.network?.connection;
  if (c === undefined) {
    return paint(`${spinner(s.tick)} detecting…`, { fg: theme.dim });
  }
  if (seemsIntercepted(s.network)) {
    return paint("? DNS intercepted", { fg: theme.warn });
  }
  if (c.filter !== undefined) {
    return paint(`✕ ${c.filter}`, { fg: theme.block });
  }
  if (c.error !== undefined) {
    return paint("? unknown", { fg: theme.warn });
  }
  return paint("· no filter detected", { fg: theme.dim });
};

/**
 * The line under the input: the verdict, or progress while checking. On a
 * narrow screen the reference answers, or the blocked count, go on a line of
 * their own.
 */
export const summaryText = (s: State, wide: boolean): StyledText => {
  if (s.checking) {
    return checkingSummary(s.result, s.tick, wide);
  }
  if (s.result?.checked === true && s.result.completion === "cancelled") {
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

/** The box at the top right: which filter this computer's DNS uses. */
export const connectionBadge = (s: State): StyledText =>
  lines([[paint("your connection  ", { fg: theme.dim }), connectionStatus(s)]]);
