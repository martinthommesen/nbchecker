import { MalformedResponse } from "./malformed.ts";

const uint16Bytes = 2;
const uint32Bytes = 4;
/** A length byte at or above this starts a compression pointer. */
const pointerTag = 0xc0;
const byteValues = 256;
/** Labels are at most 63 bytes; length bytes 0x40 to 0xbf are reserved. */
const maxLabelLength = 63;
/** A name is at most 255 bytes on the wire, length bytes included. */
const maxNameBytes = 255;
/** A name has at most 127 labels, so more jumps than that is a loop. */
const maxPointerJumps = 128;

const decoder = new TextDecoder();

/** Reads big-endian fields and compressed names from a DNS message. */
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
          throw new MalformedResponse({ reason: "name compression loop" });
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

  private checkLabel(len: number, size: number): void {
    if (len > maxLabelLength) {
      throw new MalformedResponse({ reason: "bad label length" });
    }
    if (size > maxNameBytes) {
      throw new MalformedResponse({ reason: "name is too long" });
    }
  }

  private need(n: number): void {
    if (this.offset + n > this.bytes.length) {
      throw new MalformedResponse({ reason: "response is cut short" });
    }
  }

  private byteAt(at: number): number {
    if (at >= this.bytes.length) {
      throw new MalformedResponse({ reason: "name runs past the end" });
    }
    return this.view.getUint8(at);
  }

  private slice(at: number, n: number): Uint8Array {
    if (at + n > this.bytes.length) {
      throw new MalformedResponse({ reason: "label runs past the end" });
    }
    return this.bytes.subarray(at, at + n);
  }
}
