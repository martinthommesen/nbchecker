/**
 * A small DNS wire-format codec: just enough to send A and AAAA queries with
 * EDNS and to read the answers, CNAME chains and Extended DNS Errors that
 * filters reply with.
 */
import { Effect } from "effect";
import { NetAddress } from "effect/net";
import { MalformedResponse } from "./malformed.ts";
import { Reader } from "./reader.ts";

const typeA = 1;
const typeCname = 5;
const typeAaaa = 28;
const typeOpt = 41;
const classIn = 1;

const headerLength = 12;
const headerCounts = 4;
const flagRecursionDesired = 0x01_00;
const flagTruncated = 0x02_00;
const rcodeValues = 16;
const extendedRcodeDivisor = 2 ** 24;
const maxLabelLength = 63;
/** The EDNS buffer size recommended by DNS Flag Day 2020. */
const ednsBufferSize = 1232;
const extendedErrorOption = 15;
const ipv4Length = 4;
const ipv6Length = 16;
const uint16Bytes = 2;
const questionTail = 4;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const asMalformed = (error: unknown): MalformedResponse => {
  if (error instanceof MalformedResponse) {
    return error;
  }
  return new MalformedResponse({ reason: String(error) });
};

const nameBytes = (name: string): Uint8Array[] => {
  const out: Uint8Array[] = [];
  for (const label of name.split(".").filter((l) => l !== "")) {
    const bytes = encoder.encode(label);
    if (bytes.length > maxLabelLength) {
      throw new MalformedResponse({ reason: `label too long: ${label}` });
    }
    out.push(Uint8Array.of(bytes.length), bytes);
  }
  out.push(Uint8Array.of(0));
  return out;
};

const uint16s = (...values: readonly number[]): Uint8Array => {
  const out = new Uint8Array(values.length * uint16Bytes);
  const view = new DataView(out.buffer);
  for (const [i, v] of values.entries()) {
    view.setUint16(i * uint16Bytes, v);
  }
  return out;
};

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const typeCode = (type: QueryType): number => {
  if (type === "A") {
    return typeA;
  }
  return typeAaaa;
};

const encode = (id: number, name: string, type: QueryType): Uint8Array =>
  concat([
    // Header: one question, one additional (the OPT record).
    uint16s(id, flagRecursionDesired, 1, 0, 0, 1),
    ...nameBytes(name),
    uint16s(typeCode(type), classIn),
    // OPT pseudo-record: root name, type, buffer size, TTL 0, no data.
    Uint8Array.of(0),
    uint16s(typeOpt, ednsBufferSize, 0, 0, 0),
  ]);

const addressParsers = new Map<
  number,
  (data: Uint8Array) => NetAddress.IpAddress
>([
  [ipv4Length, NetAddress.ipv4FromBytesUnsafe],
  [ipv6Length, NetAddress.ipv6FromBytesUnsafe],
]);

const formatAddress = (data: Uint8Array): string | undefined => {
  const parse = addressParsers.get(data.length);
  return parse && NetAddress.formatIp(parse(data));
};

const readExtendedErrors = (data: Uint8Array): ExtendedError[] => {
  const r = new Reader(data);
  const out: ExtendedError[] = [];
  while (r.remaining > 0) {
    const code = r.u16();
    const body = new Reader(r.take(r.u16()));
    if (code === extendedErrorOption && body.remaining >= uint16Bytes) {
      const info = body.u16();
      out.push({ code: info, text: decoder.decode(body.take(body.remaining)) });
    }
  }
  return out;
};

interface RawRecord {
  readonly data: Uint8Array;
  readonly dataOffset: number;
  readonly name: string;
  readonly ttl: number;
  readonly type: number;
}

const readRecord = (r: Reader): RawRecord => {
  const name = r.name();
  const type = r.u16();
  r.u16(); // class
  const ttl = r.u32();
  const length = r.u16();
  const dataOffset = r.offset;
  return { data: r.take(length), dataOffset, name, ttl, type };
};

const addressTypes = new Map<number, "A" | "AAAA">([
  [typeA, "A"],
  [typeAaaa, "AAAA"],
]);

const toRecord = (r: Reader, raw: RawRecord): DnsRecord | undefined => {
  if (raw.type === typeCname) {
    const saved = r.offset;
    r.offset = raw.dataOffset;
    const value = r.name();
    r.offset = saved;
    return { name: raw.name, type: "CNAME", value };
  }
  const type = addressTypes.get(raw.type);
  const value = formatAddress(raw.data);
  if (type === undefined || value === undefined) {
    return;
  }
  return { name: raw.name, type, value };
};

const times = <A>(n: number, f: () => A): A[] => Array.from({ length: n }, f);

const decode = (bytes: Uint8Array): DnsAnswer => {
  if (bytes.length < headerLength) {
    throw new MalformedResponse({ reason: "response is cut short" });
  }
  const r = new Reader(bytes);
  r.u16(); // id
  const flags = r.u16();
  const [questions = 0, answers = 0, authorities = 0, additionals = 0] = times(
    headerCounts,
    () => r.u16()
  );
  times(questions, () => {
    r.name();
    r.take(questionTail);
  });
  const records = times(answers, () => toRecord(r, readRecord(r))).filter(
    (rec) => rec !== undefined
  );
  times(authorities, () => readRecord(r));
  let rcode = flags % rcodeValues;
  const extendedErrors: ExtendedError[] = [];
  for (const raw of times(additionals, () => readRecord(r))) {
    if (raw.type === typeOpt) {
      rcode += Math.floor(raw.ttl / extendedRcodeDivisor) * rcodeValues;
      extendedErrors.push(...readExtendedErrors(raw.data));
    }
  }
  return {
    extendedErrors,
    rcode,
    records,
    truncated: Math.floor(flags / flagTruncated) % 2 === 1,
  };
};

export type QueryType = "A" | "AAAA";

export const Rcode = {
  noError: 0,
  nxDomain: 3,
  refused: 5,
  servFail: 2,
} as const;

/** One record from the answer section. */
export interface DnsRecord {
  readonly name: string;
  readonly type: "A" | "AAAA" | "CNAME";
  /** The address, or the CNAME target without its trailing dot. */
  readonly value: string;
}

/** An Extended DNS Error (RFC 8914) from the OPT record. */
export interface ExtendedError {
  readonly code: number;
  readonly text: string;
}

export interface DnsAnswer {
  readonly extendedErrors: readonly ExtendedError[];
  readonly rcode: number;
  readonly records: readonly DnsRecord[];
  readonly truncated: boolean;
}

/** Encodes a recursive query with an EDNS OPT record. */
export const encodeQuery = (
  id: number,
  name: string,
  type: QueryType
): Effect.Effect<Uint8Array, MalformedResponse> =>
  Effect.try({ catch: asMalformed, try: () => encode(id, name, type) });

/** Reads the query ID, so answers can be matched to queries. */
export const responseId = (bytes: Uint8Array): number | undefined => {
  if (bytes.length < uint16Bytes) {
    return;
  }
  return new DataView(bytes.buffer, bytes.byteOffset).getUint16(0);
};

/** Decodes a DNS response message. */
export const decodeResponse = (
  bytes: Uint8Array
): Effect.Effect<DnsAnswer, MalformedResponse> =>
  Effect.try({ catch: asMalformed, try: () => decode(bytes) });
