/** Builds the DNS records and answers that the fake networks give. */
import { Rcode } from "../dns/codes.ts";
import type { DnsAnswer, DnsRecord } from "../dns/wire.ts";

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

/** A NOERROR answer with these records. */
export const answer = (records: readonly DnsRecord[]): DnsAnswer => ({
  extendedErrors: [],
  rcode: Rcode.noError,
  records,
  truncated: false,
});

/** An answer without records: an rcode, and Extended DNS Errors by code. */
export const noRecords = (
  rcode: number,
  ...extendedErrors: readonly number[]
): DnsAnswer => ({
  extendedErrors: extendedErrors.map((code) => ({ code, text: "" })),
  rcode,
  records: [],
  truncated: false,
});
