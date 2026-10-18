/** Short and long forms of a resolver's raw answer, for display. */
import type { Reason, Verdict } from "../check/classify.ts";
import { type DnsAnswer, type DnsRecord, Rcode } from "../dns/wire.ts";

const formErr = 1;
const notImp = 4;
const rcodeNames = new Map<number, string>([
  [Rcode.noError, "NOERROR"],
  [formErr, "FORMERR"],
  [Rcode.servFail, "SERVFAIL"],
  [Rcode.nxDomain, "NXDOMAIN"],
  [notImp, "NOTIMP"],
  [Rcode.refused, "REFUSED"],
]);

/** Extended DNS Error codes (RFC 8914) that filters use. */
const edeBlocked = 15;
const edeCensored = 16;
const edeFiltered = 17;
const edeProhibited = 18;
const extendedErrorNames = new Map<number, string>([
  [edeBlocked, "Blocked"],
  [edeCensored, "Censored"],
  [edeFiltered, "Filtered"],
  [edeProhibited, "Prohibited"],
]);

/** Blocks that answer with a CNAME to a block page. */
const cnameReasons = new Set<Reason>([
  "kripos",
  "legal",
  "nettvern",
  "nettvern+",
]);

const rcodeName = (code: number): string =>
  rcodeNames.get(code) ?? `RCODE ${code}`;

const unique = (answers: readonly DnsAnswer[]): DnsRecord[] => {
  const seen = new Set<string>();
  return answers
    .flatMap((a) => a.records)
    .filter((r) => {
      const key = `${r.type} ${r.value}`;
      const fresh = !seen.has(key);
      seen.add(key);
      return fresh;
    });
};

const addressesOf = (records: readonly DnsRecord[]): DnsRecord[] => [
  ...records.filter((r) => r.type === "A"),
  ...records.filter((r) => r.type === "AAAA"),
];

const more = (n: number): string => {
  if (n > 0) {
    return ` +${n}`;
  }
  return "";
};

const statusOf = (answers: readonly DnsAnswer[]): string => {
  const codes = answers.flatMap((a) => a.extendedErrors).map((e) => e.code);
  const rcode = rcodeName(answers.find((a) => a.rcode !== 0)?.rcode ?? 0);
  if (codes.length > 0) {
    return `${rcode} · EDE ${[...new Set(codes)].join(", ")}`;
  }
  if (rcode === "NOERROR") {
    return "no records";
  }
  return rcode;
};

/** One phrase for the table, such as "CNAME nettvern-info.telenor.net". */
export const answerSummary = (
  answers: readonly DnsAnswer[],
  verdict: Verdict
): string => {
  const records = unique(answers);
  const cname = records.findLast((r) => r.type === "CNAME");
  if (cname && verdict.reason && cnameReasons.has(verdict.reason)) {
    return `CNAME ${cname.value}`;
  }
  const [first, ...rest] = addressesOf(records);
  if (first !== undefined) {
    return `${first.type} ${first.value}${more(rest.length)}`;
  }
  return statusOf(answers);
};

/** The answer written out like dig does, a line per record or status. */
export const responseLines = (answers: readonly DnsAnswer[]): string[] => {
  const lines: string[] = [];
  const failed = answers.find((a) => a.rcode !== 0);
  if (failed !== undefined) {
    lines.push(`status: ${rcodeName(failed.rcode)}`);
  }
  for (const e of answers.flatMap((a) => a.extendedErrors)) {
    const name = extendedErrorNames.get(e.code) ?? "Extended DNS Error";
    lines.push([`EDE ${e.code} (${name})`, e.text].filter(Boolean).join(": "));
  }
  const records = unique(answers);
  for (const r of records) {
    if (r.type === "CNAME") {
      lines.push(`${r.name}. CNAME`, `  ${r.value}.`);
    } else {
      lines.push(`${r.name}. ${r.type} ${r.value}`);
    }
  }
  if (records.length === 0) {
    lines.push("no answer records");
  }
  return lines;
};
