/**
 * The summary under the input: the check's overall status, or progress while
 * checking, and the hint at the end of the input.
 */
import type { StyledText, TextChunk } from "@opentui/core";
import { trustedFilters } from "../check/evidence.ts";
import { type CheckResult, realAddresses, settled } from "../check/result.ts";
import { realAnswerState, systemState } from "../report/resolver-state.ts";
import { type Status, statusOf, statusPhrases } from "../report/status.ts";
import { shortList } from "../report/view.ts";
import { lines, oneLine, paint, spinner } from "./paint.ts";
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

/** "blocked", naming the ISP's filter whose block answer this computer gets. */
const blockedPhrase = (r: CheckResult): string => {
  const own = r.system;
  if (own.kind !== "answered") {
    return "blocked";
  }
  const same = trustedFilters(r).find(
    (f) =>
      f.outcome.kind === "answered" &&
      f.outcome.verdict.reason === own.verdict.reason &&
      f.filter.onlyAnswers !== undefined
  );
  if (same === undefined) {
    return "blocked";
  }
  return `blocked (${same.filter.name})`;
};

const systemPhrase = (r: CheckResult): TextChunk => {
  switch (systemState(r)) {
    case "pending":
      return paint("asking…", { fg: theme.dim });
    case "blocked":
      return paint(blockedPhrase(r), { fg: theme.block });
    case "inspected":
      return paint("inspected", { fg: theme.warn });
    case "missing":
      return paint("no address", { fg: theme.dim });
    case "resolves":
      return paint("resolves", { fg: theme.ok });
    default:
      // It failed, or the check was cancelled first.
      return paint("no answer", { fg: theme.warn });
  }
};

const addressesPhrase = (addresses: readonly string[]): string => {
  if (addresses.length === 0) {
    return "no addresses";
  }
  return shortList(addresses, realAddressesShown);
};

const realAnswerPhrase = (r: CheckResult): TextChunk => {
  switch (realAnswerState(r)) {
    case "pending":
      return paint("asking…", { fg: theme.dim });
    case "missing":
      return paint("doesn't exist", { fg: theme.dim });
    case "resolves":
      return paint(addressesPhrase(realAddresses(r)), { fg: theme.ok });
    default:
      // It failed, or the check was cancelled first.
      return paint("unavailable", { fg: theme.warn });
  }
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

/** The status's badge and the words after it. */
const statusBadge = (status: Status): TextChunk[] => {
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
        paint(`  ${statusPhrases.cantTell}`),
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
        paint(`  ${statusPhrases.localOnly}`),
      ];
    case "missing":
      return [
        badge("DOESN'T EXIST", theme.dim),
        paint("  the real answer says so"),
      ];
    case "no-answer":
      return [
        badge("NO ANSWER", theme.warn),
        paint(`  ${statusPhrases.noAnswer}`),
      ];
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
  const status = statusBadge(statusOf(r));
  if (wide) {
    return lines([[...status, paint("   "), ...references], ...notesLines(r)]);
  }
  return lines([status, references, ...notesLines(r)]);
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

/** A cancelled check concludes nothing; it only counts what answered first. */
const cancelledSummary = (r: CheckResult): StyledText =>
  lines([
    [
      badge("CANCELLED", theme.warn),
      paint(`  ${statusPhrases.cancelled(statusOf(r))}`),
    ],
  ]);

/**
 * The line under the input: the status, or progress while checking. On a
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
    return oneLine(
      "Type a domain, URL or IP address and press enter to see which DNS filters block it.",
      { fg: theme.dim }
    );
  }
  return resultSummary(s.result, wide);
};

/** The hint at the right end of the input. */
export const inputHint = (s: State): StyledText => {
  if (s.checking) {
    return oneLine("esc cancel", { fg: theme.dim });
  }
  if (s.result?.checked !== true || s.elapsedMs === undefined) {
    return oneLine("enter check", { fg: theme.dim });
  }
  const seconds = (s.elapsedMs / msPerSecond).toFixed(1);
  const { total } = progress(s.result);
  return oneLine(`A + AAAA · checked ${total} resolvers in ${seconds} s`, {
    fg: theme.dim,
  });
};
