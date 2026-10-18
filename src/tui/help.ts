/** The help screen: the keys, what the rows mean, and how nbchecker works. */
import type { CliRenderer, StyledText, TextChunk } from "@opentui/core";
import { lines, paint } from "./paint.ts";
import type { RowState } from "./rows.ts";
import { lookOf } from "./table.ts";
import { fit } from "./text-layout.ts";
import { theme } from "./theme.ts";
import { bodyOf, pane, scrollBox } from "./widgets.ts";

const keyWidth = 10;

const keys: readonly (readonly [string, string])[] = [
  ["enter", "check what you typed"],
  ["↑ ↓", "select a row, or recall earlier checks while typing"],
  ["pgup pgdn", "move a page in the table, or scroll help and connection"],
  ["/", "type a new domain, URL or IP address"],
  ["r", "check the same target again"],
  ["c", "show which filter this computer's DNS uses, and the self-test"],
  ["y", "copy the result as text"],
  ["e", "save the result as a JSON file in the current folder"],
  ["esc", "cancel a check, or go back"],
  ["q", "quit (ctrl+c works anywhere)"],
];

/** What the rows mean, each drawn as the table draws a row in that state. */
const legend: readonly (readonly [RowState, string])[] = [
  ["blocked", "blocked: a known block answer, such as a block page or 0.0.0.0"],
  ["resolves", "resolves: an ordinary answer"],
  [
    "missing",
    "not found: the domain doesn't exist, and the real answer agrees",
  ],
  [
    "inspected",
    "inspected: sent through Cisco's inspection proxy, which may still block some URLs",
  ],
  [
    "failed",
    "no answer, or can't tell: the resolver couldn't be reached, or the real answer is needed",
  ],
  ["optional", "no answer, as expected: it only answers some networks"],
  [
    "redirected",
    "untrusted: it failed the self-test, so its answers seem to come from another resolver",
  ],
];

const legendLine = ([state, text]: readonly [RowState, string]) => {
  const { color, glyph } = lookOf(state, 0);
  return [paint(`${glyph} `, { fg: color }), paint(text)];
};

const heading = (text: string): TextChunk[] => [
  paint(text, { bold: true, fg: theme.accent }),
];

const helpText = (): StyledText =>
  lines([
    heading("Keys"),
    ...keys.map(([key, text]) => [
      paint(fit(key, keyWidth), { fg: theme.accent }),
      paint(text),
    ]),
    [],
    heading("What the rows mean"),
    ...legend.map(legendLine),
    [],
    heading("How it works"),
    [
      paint(
        "nbchecker asks each filter's DNS servers for the name's A and AAAA records, asks this computer's own resolver, and fetches the real answer over encrypted DNS. It then compares the answers with the block answers each filter is known to give. DNS filters block names, not IP addresses."
      ),
    ],
    [],
    [
      paint(
        "Once per session, nbchecker also asks each filter for a name it documents as blocked. Some networks send every DNS query to their own resolver. A filter that doesn't block its own test name is marked untrusted and its answers don't count; when most filters fail, the result says DNS seems to be intercepted. The c screen shows each filter's self-test."
      ),
    ],
    [],
    [paint("Press esc or ? to go back.", { fg: theme.dim })],
  ]);

/** The help never changes, so it is written once, when the screen is built. */
const buildHelp = (renderer: CliRenderer) => {
  const box = pane(renderer, { title: "Help" });
  box.visible = false;
  box.flexShrink = 1;
  box.minHeight = 0;
  const scroll = scrollBox(renderer);
  bodyOf(renderer, scroll).content = helpText();
  box.add(scroll);
  return { box, scroll };
};

export { buildHelp };
