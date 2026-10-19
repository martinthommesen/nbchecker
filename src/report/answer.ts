/** Short and long forms of a resolver's raw answer, for display. */
import type { Reason } from "../check/classify.ts";
import { telenorBlockCnames } from "../check/known-answers.ts";
import { extendedErrorName, Rcode, rcodeName } from "../dns/codes.ts";
import type { DnsAnswer, DnsRecord } from "../dns/wire.ts";

/** Blocks that answer with a CNAME to a block page. */
const cnameReasons: ReadonlySet<Reason> = new Set(telenorBlockCnames.values());

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

/** What an answer without addresses says, such as "NXDOMAIN · EDE 15". */
const responseStatus = (answers: readonly DnsAnswer[]): string => {
  const codes = answers.flatMap((a) => a.extendedErrors).map((e) => e.code);
  const rcode =
    answers.find((a) => a.rcode !== Rcode.noError)?.rcode ?? Rcode.noError;
  if (codes.length > 0) {
    return `${rcodeName(rcode)} · EDE ${[...new Set(codes)].join(", ")}`;
  }
  if (rcode === Rcode.noError) {
    return "no records";
  }
  return rcodeName(rcode);
};

/**
 * One phrase for the table, such as "A 192.0.2.1 +1". A block whose `reason`
 * is a CNAME to a block page shows it: "CNAME nettvern-info.telenor.net".
 */
export const answerSummary = (
  answers: readonly DnsAnswer[],
  reason?: Reason
): string => {
  const records = unique(answers);
  const cname = records.findLast((r) => r.type === "CNAME");
  if (cname && reason !== undefined && cnameReasons.has(reason)) {
    return `CNAME ${cname.value}`;
  }
  const [first, ...rest] = addressesOf(records);
  if (first !== undefined) {
    return `${first.type} ${first.value}${more(rest.length)}`;
  }
  return responseStatus(answers);
};

/** The answer written out like dig does, a line per record or status. */
export const responseLines = (answers: readonly DnsAnswer[]): string[] => {
  const lines: string[] = [];
  const failed = answers.find((a) => a.rcode !== Rcode.noError);
  if (failed !== undefined) {
    lines.push(`status: ${rcodeName(failed.rcode)}`);
  }
  for (const e of answers.flatMap((a) => a.extendedErrors)) {
    const name = extendedErrorName(e.code) ?? "Extended DNS Error";
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
