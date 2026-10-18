import { MalformedMessage } from "./malformed.ts";
import {
  Flag,
  maxLabelLength,
  rcodeValues,
  uint16Bytes,
  uint32Bytes,
} from "./protocol.ts";

/** A length byte at or above this starts a compression pointer. */
const pointerTag = 0xc0;
const byteValues = 256;
/** A name is at most 255 bytes on the wire, length bytes included. */
const maxNameBytes = 255;
/** A name has at most 127 labels, so more jumps than that is a loop. */
const maxPointerJumps = 128;
/** The opcode sits above the AA, TC, RD, RA, Z and rcode bits. */
const opcodeUnit = 0x08_00;
const opcodeValues = 16;

const decoder = new TextDecoder();

const hasFlag = (flags: number, flag: number): boolean =>
  Math.floor(flags / flag) % 2 === 1;

/** A message's header, with the flags that say what kind of reply it is. */
export interface Header {
  readonly additionals: number;
  readonly answers: number;
  readonly authorities: number;
  readonly id: number;
  readonly isResponse: boolean;
  readonly opcode: number;
  readonly questions: number;
  /** The rcode's low four bits; an OPT record can carry the rest. */
  readonly rcode: number;
  readonly truncated: boolean;
}

/** What a question asks for. */
export interface Question {
  readonly dnsClass: number;
  readonly name: string;
  readonly type: number;
}

/** Reads big-endian fields, names, headers and questions from a message. */
export class Reader {
  offset = 0;
  private readonly bytes: Uint8Array;
  private readonly view: DataView;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  u16(): number {
    this.need(uint16Bytes);
    const v = this.view.getUint16(this.offset);
    this.offset += uint16Bytes;
    return v;
  }

  u32(): number {
    this.need(uint32Bytes);
    const v = this.view.getUint32(this.offset);
    this.offset += uint32Bytes;
    return v;
  }

  take(n: number): Uint8Array {
    this.need(n);
    const v = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return v;
  }

  /** Reads a possibly compressed name, leaving the offset after it. */
  name(): string {
    const labels: string[] = [];
    let at = this.offset;
    let resumeAt: number | undefined;
    let jumps = 0;
    let size = 1;
    for (;;) {
      const len = this.byteAt(at);
      if (len === 0) {
        this.offset = resumeAt ?? at + 1;
        return labels.join(".").toLowerCase();
      }
      if (len >= pointerTag) {
        jumps += 1;
        if (jumps > maxPointerJumps) {
          throw new MalformedMessage({ reason: "name compression loop" });
        }
        resumeAt ??= at + uint16Bytes;
        at = (len - pointerTag) * byteValues + this.byteAt(at + 1);
      } else {
        size += len + 1;
        this.checkLabel(len, size);
        labels.push(decoder.decode(this.slice(at + 1, len)));
        at += len + 1;
      }
    }
  }

  /** Reads the header that starts every message. */
  header(): Header {
    const id = this.u16();
    const flags = this.u16();
    const questions = this.u16();
    const answers = this.u16();
    const authorities = this.u16();
    const additionals = this.u16();
    return {
      additionals,
      answers,
      authorities,
      id,
      isResponse: hasFlag(flags, Flag.response),
      opcode: Math.floor(flags / opcodeUnit) % opcodeValues,
      questions,
      rcode: flags % rcodeValues,
      truncated: hasFlag(flags, Flag.truncated),
    };
  }

  /** Reads one entry of the question section. */
  question(): Question {
    const name = this.name();
    const type = this.u16();
    const dnsClass = this.u16();
    return { dnsClass, name, type };
  }

  private checkLabel(len: number, size: number): void {
    if (len > maxLabelLength) {
      throw new MalformedMessage({ reason: "bad label length" });
    }
    if (size > maxNameBytes) {
      throw new MalformedMessage({ reason: "name is too long" });
    }
  }

  private need(n: number): void {
    if (this.offset + n > this.bytes.length) {
      throw new MalformedMessage({ reason: "response is cut short" });
    }
  }

  private byteAt(at: number): number {
    if (at >= this.bytes.length) {
      throw new MalformedMessage({ reason: "name runs past the end" });
    }
    return this.view.getUint8(at);
  }

  private slice(at: number, n: number): Uint8Array {
    if (at + n > this.bytes.length) {
      throw new MalformedMessage({ reason: "label runs past the end" });
    }
    return this.bytes.subarray(at, at + n);
  }
}
