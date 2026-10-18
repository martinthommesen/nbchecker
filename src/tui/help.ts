/** The help screen. */
import type { StyledText, TextChunk } from "@opentui/core";
import { fit, lines, paint } from "./paint.ts";
import { theme } from "./theme.ts";

const keyWidth = 10;

const keys: readonly (readonly [string, string])[] = [
  ["enter", "check what you typed"],
  ["↑ ↓", "select a row, or recall earlier checks while typing"],
  ["/", "type a new domain, URL or IP address"],
  ["r", "check the same target again"],
  ["c", "show which filter this computer's DNS uses"],
  ["y", "copy the result as text"],
  ["e", "save the result as a JSON file in the current folder"],
  ["esc", "cancel a check, or go back"],
  ["q", "quit (ctrl+c works anywhere)"],
];

const glyphs: readonly (readonly [string, string, string])[] = [
  [
    "✕",
    theme.block,
    "blocked: a known block answer, such as a block page or 0.0.0.0",
  ],
  ["✓", theme.ok, "resolves: an ordinary answer"],
  [
    "–",
    theme.dim,
    "not found: the domain doesn't exist, and the real answer agrees",
  ],
  ["?", theme.warn, "no answer: the resolver couldn't be reached"],
  ["·", theme.faint, "no answer, as expected: it only answers some networks"],
];

const heading = (text: string): TextChunk[] => [
  paint(text, { bold: true, fg: theme.accent }),
];

export const helpText = (): StyledText =>
  lines([
    heading("Keys"),
    ...keys.map(([key, text]) => [
      paint(fit(key, keyWidth), { fg: theme.accent }),
      paint(text),
    ]),
    [],
    heading("What the rows mean"),
    ...glyphs.map(([glyph, color, text]) => [
      paint(`${glyph} `, { fg: color }),
      paint(text),
    ]),
    [],
    heading("How it works"),
    [
      paint(
        "nbchecker asks each filter's DNS servers for the name's A and AAAA records, asks this computer's own resolver, and fetches the real answer over encrypted DNS. It then compares the answers with the block answers each filter is known to give. DNS filters block names, not IP addresses."
      ),
    ],
    [],
    [paint("Press esc or ? to go back.", { fg: theme.dim })],
  ]);
