/** Renders a result view as text, with ANSI colors for terminals. */
import { printable } from "./printable.ts";
import type { Row, Tone, View } from "./view.ts";

const csi = "\u001B[";
const reset = `${csi}0m`;
const toneCodes: Record<Tone, string> = {
  blocked: "1;31",
  dim: "2",
  ok: "32",
  plain: "",
  warn: "33",
};
const headingCode = "1;36";
const hostCode = "1";
const indent = "  ";

const ansi = (color: boolean, code: string, s: string): string => {
  const safe = printable(s);
  if (!color || code === "") {
    return safe;
  }
  return `${csi}${code}m${safe}${reset}`;
};

const nameWidth = (v: View): number =>
  Math.max(0, ...v.sections.flatMap((s) => s.rows.map((r) => r.name.length)));

const rowText = (color: boolean, width: number, r: Row): string => {
  const tone = toneCodes[r.tone];
  let text = ansi(color, tone, r.text);
  if (r.detail !== undefined && r.detail !== "") {
    text += ansi(color, toneCodes.dim, ` → ${r.detail}`);
  }
  return `${indent}${ansi(color, tone, r.icon)} ${printable(r.name).padEnd(width)}  ${text}`;
};

/** Renders one result. `color` turns ANSI colors on. */
export const renderText = (v: View, color: boolean): string => {
  const width = nameWidth(v);
  const out = [
    `${ansi(color, hostCode, v.host)}  ${ansi(color, toneCodes[v.summary.tone], v.summary.text)}`,
    ...v.notes.map((n) => ansi(color, toneCodes.dim, n)),
  ];
  for (const s of v.sections) {
    out.push(
      "",
      ansi(color, headingCode, s.title),
      ...s.rows.map((r) => rowText(color, width, r))
    );
  }
  return `${out.join("\n")}\n`;
};

/** The line above text results that says which DNS filter this computer uses. */
export const dnsFilterLine = (name: string): string =>
  `DNS filter on this computer: ${name}`;
