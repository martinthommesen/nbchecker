/** Builds the DNS records and answers that the fake networks give. */
import { Rcode } from "../dns/codes.ts";
import type { DnsAnswer, DnsRecord, ExtendedError } from "../dns/wire.ts";

/** An Extended DNS Error, or just its code when its text doesn't matter. */
type ErrorSpec = ExtendedError | number;

const extendedError = (spec: ErrorSpec): ExtendedError => {
  if (typeof spec === "number") {
    return { code: spec, text: "" };
  }
  return spec;
};

export const a = (name: string, value: string): DnsRecord => ({
  name,
  type: "A",
  value,
});

export const aaaa = (name: string, value: string): DnsRecord => ({
  name,
  type: "AAAA",
  value,
});

export const cname = (name: string, value: string): DnsRecord => ({
  name,
  type: "CNAME",
  value,
});

/** A NOERROR answer with these records, unless `extra` says otherwise. */
export const answer = (
  records: readonly DnsRecord[],
  extra: Partial<DnsAnswer> = {}
): DnsAnswer => ({
  extendedErrors: [],
  rcode: Rcode.noError,
  records,
  truncated: false,
  ...extra,
});

/** An answer without records: an rcode and any Extended DNS Errors. */
export const noRecords = (
  rcode: number,
  ...errors: readonly ErrorSpec[]
): DnsAnswer =>
  answer([], { extendedErrors: errors.map(extendedError), rcode });
