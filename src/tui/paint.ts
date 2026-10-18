/** Helpers for building coloured lines of text. */
import { bg, bold, fg, StyledText, type TextChunk } from "@opentui/core";
import { printable } from "../report/printable.ts";
import { fit } from "./text-layout.ts";
import { theme } from "./theme.ts";

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface Ink {
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

/** A text of one line in one style. */
export const oneLine = (text: string, ink: Ink = {}): StyledText =>
  lines([[paint(text, ink)]]);

/**
 * A line of a shaded block, such as a raw DNS response, filled to `width` so
 * the shading reaches the edge. Without a width, as when copying, the text
 * is left as it is.
 */
export const shaded = (
  text: string,
  width: number,
  color: string = theme.answer
): TextChunk => {
  let filled = text;
  if (width > 0) {
    filled = fit(text, width);
  }
  return paint(filled, { bg: theme.response, fg: color });
};

/** The text without its styles, as it is copied. */
export const plainText = (t: StyledText): string =>
  t.chunks.map((c) => c.text).join("");
