/**
 * A small DNS wire-format codec: just enough to send A and AAAA queries with
 * EDNS and to read the answers, CNAME chains and Extended DNS Errors that
 * filters reply with.
 */
import { Effect } from "effect";
import { NetAddress } from "effect/net";
import { concat, uint16s } from "./bytes.ts";
import { MalformedResponse } from "./malformed.ts";
import {
  classIn,
  extendedErrorOption,
  extendedRcodeUnit,
  Flag,
  maxLabelLength,
  RecordType,
  rcodeValues,
  uint16Bytes,
} from "./protocol.ts";
import { Reader } from "./reader.ts";

/** The EDNS buffer size recommended by DNS Flag Day 2020. */
const ednsBufferSize = 1232;
const ipv4Length = 4;
const ipv6Length = 16;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const asMalformed = (error: unknown): MalformedResponse => {
  if (error instanceof MalformedResponse) {
    return error;
  }
  return new MalformedResponse({ reason: String(error) });
};

const labelBytes = (label: string): Uint8Array[] => {
  const bytes = encoder.encode(label);
  if (bytes.length > maxLabelLength) {
    throw new MalformedResponse({ reason: `label too long: ${label}` });
  }
  return [Uint8Array.of(bytes.length), bytes];
};

const encode = (id: number, name: string, type: QueryType): Uint8Array =>
  concat([
    // Header: one question, one additional (the OPT record).
    uint16s(id, Flag.recursionDesired, 1, 0, 0, 1),
    encodeName(name),
    uint16s(typeCode(type), classIn),
    // OPT pseudo-record: root name, type, buffer size, TTL 0, no data.
    Uint8Array.of(0),
    uint16s(RecordType.opt, ednsBufferSize, 0, 0, 0),
  ]);

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

interface AddressType {
  readonly length: number;
  readonly parse: (data: Uint8Array) => NetAddress.IpAddress;
  readonly type: "A" | "AAAA";
}

const addressTypes = new Map<number, AddressType>([
  [
    RecordType.a,
    { length: ipv4Length, parse: NetAddress.ipv4FromBytesUnsafe, type: "A" },
  ],
  [
    RecordType.aaaa,
    { length: ipv6Length, parse: NetAddress.ipv6FromBytesUnsafe, type: "AAAA" },
  ],
]);

/**
 * Reads a CNAME target, which must end where its record does. Pointers to
 * earlier parts of the message are fine.
 */
const readCname = (bytes: Uint8Array, raw: RawRecord): string => {
  const end = raw.dataOffset + raw.data.length;
  const r = new Reader(bytes.subarray(0, end));
  r.offset = raw.dataOffset;
  try {
    const value = r.name();
    if (r.offset === end) {
      return value;
    }
  } catch (error) {
    if (!(error instanceof MalformedResponse)) {
      throw error;
    }
  }
  throw new MalformedResponse({ reason: "bad CNAME record" });
};

const toRecord = (bytes: Uint8Array, raw: RawRecord): DnsRecord | undefined => {
  if (raw.type === RecordType.cname) {
    return { name: raw.name, type: "CNAME", value: readCname(bytes, raw) };
  }
  const address = addressTypes.get(raw.type);
  if (address === undefined) {
    return;
  }
  if (raw.data.length !== address.length) {
    throw new MalformedResponse({ reason: `bad ${address.type} record` });
  }
  const value = NetAddress.formatIp(address.parse(raw.data));
  return { name: raw.name, type: address.type, value };
};

const times = <A>(n: number, f: () => A): A[] => Array.from({ length: n }, f);

const decode = (bytes: Uint8Array): DnsAnswer => {
  const r = new Reader(bytes);
  const header = r.header();
  times(header.questions, () => r.question());
  const records = times(header.answers, () =>
    toRecord(bytes, readRecord(r))
  ).filter((rec) => rec !== undefined);
  times(header.authorities, () => readRecord(r));
  let { rcode } = header;
  const extendedErrors: ExtendedError[] = [];
  for (const raw of times(header.additionals, () => readRecord(r))) {
    if (raw.type === RecordType.opt) {
      rcode += Math.floor(raw.ttl / extendedRcodeUnit) * rcodeValues;
      extendedErrors.push(...readExtendedErrors(raw.data));
    }
  }
  return { extendedErrors, rcode, records, truncated: header.truncated };
};

export type QueryType = "A" | "AAAA";

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

/** The code a record type has on the wire. */
export const typeCode = (type: DnsRecord["type"]): number => {
  if (type === "A") {
    return RecordType.a;
  }
  if (type === "AAAA") {
    return RecordType.aaaa;
  }
  return RecordType.cname;
};

/**
 * Writes a name as length-prefixed labels. Throws a `MalformedResponse` for
 * a label longer than 63 bytes.
 */
export const encodeName = (name: string): Uint8Array => {
  const labels = name.split(".").filter((l) => l !== "");
  return concat([...labels.flatMap(labelBytes), Uint8Array.of(0)]);
};

/** Encodes a recursive query with an EDNS OPT record. */
export const encodeQuery = (
  id: number,
  name: string,
  type: QueryType
): Effect.Effect<Uint8Array, MalformedResponse> =>
  Effect.try({ catch: asMalformed, try: () => encode(id, name, type) });

/** Decodes a DNS response message. */
export const decodeResponse = (
  bytes: Uint8Array
): Effect.Effect<DnsAnswer, MalformedResponse> =>
  Effect.try({ catch: asMalformed, try: () => decode(bytes) });
