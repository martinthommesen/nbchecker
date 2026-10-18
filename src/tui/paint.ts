/** Helpers for building coloured lines of text. */
import { bg, bold, fg, StyledText, type TextChunk } from "@opentui/core";
import { printable } from "../report/printable.ts";
import { theme } from "./theme.ts";

export const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface Ink {
  readonly bg?: string;
  readonly bold?: boolean;
  readonly fg?: string;
}

/** One piece of text in one style. */
export const paint = (text: string, ink: Ink = {}): TextChunk => {
  // Every chunk gets a colour, so the look doesn't depend on the terminal's.
  let chunk = fg(ink.fg ?? theme.text)({
    __isChunk: true,
    text: printable(text),
  });
  if (ink.bg !== undefined) {
    chunk = bg(ink.bg)(chunk);
  }
  if (ink.bold === true) {
    chunk = bold(chunk);
  }
  return chunk;
};

/** The width of a string in terminal columns, for the text nbchecker shows. */
export const columns = (s: string): number => [...s].length;

/** Pads or cuts `s` to exactly `n` columns, marking a cut with an ellipsis. */
export const fit = (s: string, n: number): string => {
  if (n <= 0) {
    return "";
  }
  const chars = [...s];
  if (chars.length > n) {
    return `${chars.slice(0, n - 1).join("")}…`;
  }
  return s + " ".repeat(n - chars.length);
};

/**
 * Breaks `s` into lines of at most `n` columns, at spaces where it can and
 * inside a word too long for a line. Every line keeps the indent `s` starts
 * with, and lines after the first are indented by `hang` more columns, so
 * they read as part of the first.
 */
export const wrap = (s: string, n: number, hang = 0): string[] => {
  const text = s.trimStart();
  const indent = s.slice(0, s.length - text.length);
  if (indent !== "") {
    return wrap(text, n - columns(indent), hang).map((l) => indent + l);
  }
  const out: string[] = [];
  const room = () => n - Math.min(out.length, 1) * hang;
  let line = "";
  for (const word of s.split(" ")) {
    let joined = word;
    if (line !== "") {
      joined = `${line} ${word}`;
    }
    if (columns(joined) <= room()) {
      line = joined;
    } else {
      if (line !== "") {
        out.push(line);
      }
      let chars = [...word];
      let size = room();
      while (size > 0 && chars.length > size) {
        out.push(chars.slice(0, size).join(""));
        chars = chars.slice(size);
        size = room();
      }
      line = chars.join("");
    }
  }
  out.push(line);
  return out.map((l, i) => " ".repeat(Math.min(i, 1) * hang) + l);
};

/** Right-aligns `s` in `n` columns. */
export const fitRight = (s: string, n: number): string =>
  " ".repeat(Math.max(n - columns(s), 0)) + s;

/**
 * Joins lines of chunks into one text, a newline between each. The newline
 * is built here, since `paint` replaces newlines in the text it is given.
 */
export const lines = (rows: readonly (readonly TextChunk[])[]): StyledText =>
  new StyledText(
    rows.flatMap((row, i) => {
      if (i === 0) {
        return [...row];
      }
      return [{ __isChunk: true, text: "\n" } satisfies TextChunk, ...row];
    })
  );

/** The spinner frame for a tick count. */
export const spinner = (tick: number): string =>
  spinnerFrames[tick % spinnerFrames.length] ?? "";
