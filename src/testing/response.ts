/** Builds DNS response messages for tests. */
import { NetAddress } from "effect/net";
import { Reader } from "../dns/reader.ts";
import type { DnsRecord, ExtendedError, QueryType } from "../dns/wire.ts";

const typeA = 1;
const typeCname = 5;
const typeAaaa = 28;
const typeCodes = new Map<DnsRecord["type"], number>([
  ["A", typeA],
  ["AAAA", typeAaaa],
  ["CNAME", typeCname],
]);
const questionTypes = new Map<number, QueryType>([
  [typeA, "A"],
  [typeAaaa, "AAAA"],
]);
const typeOpt = 41;
const classIn = 1;
const ttl = 60;
const flagResponse = 0x80_00;
const flagTruncated = 0x02_00;
const rcodeValues = 16;
const extendedRcodeMultiplier = 2 ** 24;
const extendedErrorOption = 15;
const uint16Bytes = 2;
const uint32Bytes = 4;
const headerLength = 12;
const encoder = new TextEncoder();

const bytes = (...parts: readonly (number[] | Uint8Array)[]): number[] =>
  parts.flatMap((p) => [...p]);

const u16 = (n: number): number[] => {
  const b = new Uint8Array(uint16Bytes);
  new DataView(b.buffer).setUint16(0, n);
  return [...b];
};

const u32 = (n: number): number[] => {
  const b = new Uint8Array(uint32Bytes);
  new DataView(b.buffer).setUint32(0, n);
  return [...b];
};

const name = (n: string): number[] =>
  bytes(
    ...n
      .split(".")
      .filter((l) => l !== "")
      .map((l) => bytes([l.length], encoder.encode(l))),
    [0]
  );

const rdata = (r: DnsRecord): number[] => {
  if (r.type === "CNAME") {
    return name(r.value);
  }
  const ip = NetAddress.ipFromStringUnsafe(r.value);
  if (NetAddress.isIpv4Address(ip)) {
    return [...NetAddress.ipv4ToOctets(ip)];
  }
  return [...NetAddress.ipv6ToOctets(ip)];
};

const record = (r: DnsRecord): number[] => {
  const data = rdata(r);
  return bytes(
    name(r.name),
    u16(typeCodes.get(r.type) ?? 0),
    u16(classIn),
    u32(ttl),
    u16(data.length),
    data
  );
};

const opt = (rcode: number, errors: readonly ExtendedError[]): number[] => {
  const options = errors.flatMap((e) => {
    const text = encoder.encode(e.text);
    return bytes(
      u16(extendedErrorOption),
      u16(text.length + uint16Bytes),
      u16(e.code),
      text
    );
  });
  const extended = Math.floor(rcode / rcodeValues) * extendedRcodeMultiplier;
  return bytes(
    [0],
    u16(typeOpt),
    u16(classIn),
    u32(extended),
    u16(options.length),
    options
  );
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

/** Encodes a response with an optional OPT record. */
export const response = (spec: ResponseSpec): Uint8Array => {
  const records = spec.records ?? [];
  const rcode = spec.rcode ?? 0;
  const errors = spec.extendedErrors ?? [];
  let flags = flagResponse + (rcode % rcodeValues);
  if (spec.truncated === true) {
    flags += flagTruncated;
  }
  return Uint8Array.from(
    bytes(
      u16(spec.id ?? 0),
      u16(flags),
      u16(1),
      u16(records.length),
      u16(0),
      u16(1),
      name(spec.question ?? "example.com"),
      u16(typeCodes.get(spec.questionType ?? "A") ?? typeA),
      u16(classIn),
      ...records.map(record),
      opt(rcode, errors)
    )
  );
};

/** Encodes a response to `query`, with its ID and question. */
export const replyTo = (query: Uint8Array, spec: ResponseSpec = {}) => {
  const r = new Reader(query);
  const id = r.u16();
  r.offset = headerLength;
  const question = r.name();
  const questionType = questionTypes.get(r.u16()) ?? "A";
  return response({ id, question, questionType, ...spec });
};
