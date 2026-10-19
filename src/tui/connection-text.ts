/** The "your connection" screen: which filter this computer's DNS uses. */
import type { StyledText, TextChunk } from "@opentui/core";
import type { Connection } from "../check/connection.ts";
import type { Filter } from "../check/filters.ts";
import { telenorTestPage } from "../check/known-answers.ts";
import type { Network, SelfTestResult } from "../check/result.ts";
import { categoryLabels, categoryOrder } from "../report/categories.ts";
import { lines, oneLine, paint, plainText, shaded, spinner } from "./paint.ts";
import { fit } from "./text-layout.ts";
import { theme } from "./theme.ts";

const nameWidth = 24;
const markWidth = 14;
const lookupWidth = 24;
const addressWidth = 15;

const mark = {
  cantSee: { color: theme.warn, glyph: "?", text: "can't see" },
  detected: { color: theme.block, glyph: "✕", text: "detected" },
  noTest: { color: theme.faint, glyph: "·", text: "no test page" },
  notSeen: { color: theme.dim, glyph: "·", text: "not seen" },
} as const;

/**
 * SafeZone has no server to ask, so it is only listed here, after the first
 * of Telenor's filters on its test page.
 */
const safeZoneFollows = telenorTestPage.answers[0]?.filter;

/** Each pane's title, as the screen shows it and its copied text repeats it. */
const paneTitles = {
  browser: "Your browser may differ",
  detected: "Detected filter",
  filters: "Filters we look for",
  how: "How we know",
  safeZone: "About SafeZone",
} as const;

const selfTestNote =
  "Self-test: each filter is asked for a name it documents as blocked. One that doesn't block it is marked redirected?: its answers seem to come from another resolver, so they don't count.";

interface Mark {
  readonly color: string;
  readonly glyph: string;
  readonly text: string;
}

const prose = (text: string): TextChunk[] => [paint(text)];

const detectedLines = (c: Connection): TextChunk[][] => {
  if (c.filter !== undefined) {
    const short = c.filter.replace("Telenor ", "");
    return [
      [paint(`✕ ${c.filter}`, { bold: true, fg: theme.block })],
      prose(
        `Lookups from this computer get ${short}'s answers. Sites ${short} blocks show Telenor's warning page instead.`
      ),
    ];
  }
  if (c.error !== undefined) {
    return [
      [paint("? Unknown", { bold: true, fg: theme.warn })],
      prose(`The test lookup failed: ${c.error}`),
    ];
  }
  return [
    [paint("· No filter detected", { bold: true, fg: theme.dim })],
    prose(
      "nbchecker didn't recognise a filter on this computer's DNS. Only Telenor publishes a test page, so a public filter set up on this computer or router isn't detected here. The Your DNS row of each check shows what this computer really gets."
    ),
  ];
};

const testAnswerText = (c: Connection): string => {
  if (c.error !== undefined) {
    return "lookup failed";
  }
  if (c.testAnswers.length === 0) {
    return "doesn't exist";
  }
  return c.testAnswers.join(", ");
};

/** What the test lookup saw: a filter, no filter, or nothing either way. */
const seenMark = (c: Connection): Mark => {
  if (c.filter !== undefined) {
    return mark.detected;
  }
  if (c.error !== undefined) {
    return mark.cantSee;
  }
  return mark.notSeen;
};

const telenorMark = (c: Connection | undefined, name: string): Mark => {
  if (c === undefined) {
    return mark.cantSee;
  }
  // Seeing one of Telenor's filters is not seeing the others.
  if (c.filter !== undefined && c.filter !== name) {
    return mark.notSeen;
  }
  return seenMark(c);
};

/** Whether Telenor's test page can tell that this computer uses `f`. */
const onTestPage = (f: Filter): boolean =>
  telenorTestPage.answers.some((a) => a.filter === f.name);

const markOf = (c: Connection | undefined, f: Filter): Mark => {
  if (onTestPage(f)) {
    return telenorMark(c, f.name);
  }
  return mark.noTest;
};

const filterRow = (name: string, m: Mark): TextChunk[] => [
  paint(`${m.glyph} `, { fg: m.color }),
  paint(fit(name, nameWidth)),
  paint(fit(m.text, markWidth), { fg: m.color }),
];

/** What the screen says while the connection is being detected. */
const detecting = (tick: number): TextChunk =>
  paint(`${spinner(tick)} detecting…`, { fg: theme.dim });

/** What was detected. */
const detectedText = (c: Connection | undefined, tick: number): StyledText => {
  if (c === undefined) {
    return lines([[detecting(tick)]]);
  }
  return lines([
    ...detectedLines(c),
    [paint("Checked against Telenor's test page.", { fg: theme.dim })],
  ]);
};

/** How it was detected: the test lookup and what its answers mean. */
const howText = (c: Connection | undefined, width: number): StyledText => {
  if (c === undefined) {
    return lines([]);
  }
  const seen = seenMark(c);
  return lines([
    [
      paint(fit("test lookup", lookupWidth), { fg: theme.dim }),
      paint("this computer got", { fg: theme.dim }),
    ],
    [
      paint(`${seen.glyph} `, { fg: seen.color }),
      paint(fit(telenorTestPage.name, lookupWidth - 2)),
      paint(testAnswerText(c)),
    ],
    [],
    [shaded(" Telenor's test page answers differently per filter:", width)],
    ...telenorTestPage.answers.map(({ ip, meaning }) => [
      shaded(`   ${fit(ip, addressWidth)}${meaning}`, width),
    ]),
    [],
    prose(selfTestNote),
  ]);
};

const selfTestMarks: Record<SelfTestResult, Mark> = {
  "no-answer": { color: theme.faint, glyph: "·", text: "no answer" },
  passed: { color: theme.ok, glyph: "✓", text: "passed" },
  redirected: { color: theme.warn, glyph: "?", text: "redirected?" },
  untested: { color: theme.faint, glyph: "·", text: "no test name" },
};

/** The self-test column: whether a filter's answers are its own. */
const selfTestChunk = (n: Network | undefined, f: Filter): TextChunk => {
  if (n === undefined) {
    return paint("…", { fg: theme.dim });
  }
  const test = n.selfTests.find((t) => t.filter === f.name);
  const m = selfTestMarks[test?.result ?? "no-answer"];
  return paint(`${m.glyph} ${m.text}`, { fg: m.color });
};

/**
 * Every filter: whether it was seen on this computer's DNS, and how it
 * answered the self-test.
 */
const filtersText = (
  n: Network | undefined,
  items: readonly Filter[]
): StyledText => {
  const c = n?.connection;
  const out: TextChunk[][] = [
    [
      paint(fit("", nameWidth + 2)),
      paint(fit("your DNS", markWidth), { fg: theme.faint }),
      paint("self-test", { fg: theme.faint }),
    ],
  ];
  for (const category of categoryOrder) {
    out.push([
      paint(categoryLabels[category].shortHeading, { fg: theme.faint }),
    ]);
    for (const f of items.filter((x) => x.category === category)) {
      out.push([...filterRow(f.name, markOf(c, f)), selfTestChunk(n, f)]);
      if (f.name === safeZoneFollows) {
        out.push(filterRow("Telenor SafeZone", mark.cantSee));
      }
    }
  }
  return lines(out);
};

const safeZone = [
  "SafeZone filters inside Telenor's mobile network and has no public server to ask.",
  "nbchecker can only see it when this computer is online through a SafeZone phone hotspot or VPN, as the Your DNS row.",
] as const;

const browser =
  "Browsers with secure DNS turned on ask their own server, so a site can open there even when this computer is blocked.";

/** Why SafeZone is only seen from inside its network. */
const safeZoneText = (): StyledText =>
  lines([prose(safeZone[0]), [paint(safeZone[1], { fg: theme.dim })]]);

/** Why a browser can disagree with this computer. */
const browserText = (): StyledText => oneLine(browser, { fg: theme.dim });

/** The connection screen as plain text, for copying. */
const connectionCopy = (
  n: Network | undefined,
  items: readonly Filter[]
): string =>
  [
    { body: detectedText(n?.connection, 0), title: paneTitles.detected },
    { body: howText(n?.connection, 0), title: paneTitles.how },
    { body: filtersText(n, items), title: paneTitles.filters },
    { body: safeZoneText(), title: paneTitles.safeZone },
    { body: browserText(), title: paneTitles.browser },
  ]
    .map(({ body, title }) => `${title}\n${plainText(body)}`)
    .join("\n\n");

export {
  browserText,
  connectionCopy,
  detectedText,
  detecting,
  filtersText,
  howText,
  paneTitles,
  safeZoneText,
};
