/** Helpers for building coloured lines of text. */
import { bg, bold, fg, StyledText, type TextChunk } from "@opentui/core";
import { printable } from "../report/printable.ts";
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
