/** Builds DNS response messages for tests. */
import { NetAddress } from "effect/net";
import { concat, uint16s } from "../dns/bytes.ts";
import { Rcode } from "../dns/codes.ts";
import {
  classIn,
  extendedErrorOption,
  extendedRcodeUnit,
  Flag,
  RecordType,
  rcodeValues,
  uint16Bytes,
  uint32Bytes,
} from "../dns/protocol.ts";
import { Reader } from "../dns/reader.ts";
import {
  type DnsRecord,
  type ExtendedError,
  encodeName,
  type QueryType,
  typeCode,
} from "../dns/wire.ts";

const ttl = 60;
const encoder = new TextEncoder();

const uint32 = (n: number): Uint8Array => {
  const out = new Uint8Array(uint32Bytes);
  new DataView(out.buffer).setUint32(0, n);
  return out;
};

const rdata = (r: DnsRecord): Uint8Array => {
  if (r.type === "CNAME") {
    return encodeName(r.value);
  }
  const ip = NetAddress.ipFromStringUnsafe(r.value);
  if (NetAddress.isIpv4Address(ip)) {
    return Uint8Array.from(NetAddress.ipv4ToOctets(ip));
  }
  return Uint8Array.from(NetAddress.ipv6ToOctets(ip));
};

const record = (r: DnsRecord): Uint8Array => {
  const data = rdata(r);
  return concat([
    encodeName(r.name),
    uint16s(typeCode(r.type), classIn),
    uint32(ttl),
    uint16s(data.length),
    data,
  ]);
};

const extendedError = (e: ExtendedError): Uint8Array => {
  const text = encoder.encode(e.text);
  return concat([
    uint16s(extendedErrorOption, text.length + uint16Bytes, e.code),
    text,
  ]);
};

/** An OPT record with the rcode's upper bits and the Extended DNS Errors. */
const opt = (rcode: number, errors: readonly ExtendedError[]): Uint8Array => {
  const options = concat(errors.map(extendedError));
  const extended = Math.floor(rcode / rcodeValues) * extendedRcodeUnit;
  return concat([
    Uint8Array.of(0),
    uint16s(RecordType.opt, classIn),
    uint32(extended),
    uint16s(options.length),
    options,
  ]);
};

/** The type a question asks for; the tests only ask for A and AAAA. */
const queryType = (code: number): QueryType => {
  if (code === RecordType.aaaa) {
    return "AAAA";
  }
  return "A";
};

export interface ResponseSpec {
  readonly extendedErrors?: readonly ExtendedError[];
  readonly id?: number;
  readonly question?: string;
  readonly questionType?: QueryType;
  readonly rcode?: number;
  readonly records?: readonly DnsRecord[];
  readonly truncated?: boolean;
}

/**
 * Encodes a response with one question, the records and an OPT record that
 * carries the rcode's upper bits and any Extended DNS Errors.
 */
export const response = (spec: ResponseSpec): Uint8Array => {
  const records = spec.records ?? [];
  const rcode = spec.rcode ?? Rcode.noError;
  let flags = Flag.response + (rcode % rcodeValues);
  if (spec.truncated === true) {
    flags += Flag.truncated;
  }
  return concat([
    // Header: one question, the records, no authorities, the OPT record.
    uint16s(spec.id ?? 0, flags, 1, records.length, 0, 1),
    encodeName(spec.question ?? "example.com"),
    uint16s(typeCode(spec.questionType ?? "A"), classIn),
    ...records.map(record),
    opt(rcode, spec.extendedErrors ?? []),
  ]);
};

/** Encodes a response to `query`, with its ID and question. */
export const replyTo = (query: Uint8Array, spec: ResponseSpec = {}) => {
  const r = new Reader(query);
  const { id } = r.header();
  const question = r.question();
  return response({
    id,
    question: question.name,
    questionType: queryType(question.type),
    ...spec,
  });
};
