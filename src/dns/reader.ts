import { MalformedResponse } from "./malformed.ts";

const uint16Bytes = 2;
const uint32Bytes = 4;
/** A length byte at or above this starts a compression pointer. */
const pointerTag = 0xc0;
const byteValues = 256;
const maxPointerJumps = 32;

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
    for (let jumps = 0; jumps <= maxPointerJumps; jumps += 1) {
      const len = this.byteAt(at);
      if (len === 0) {
        this.offset = resumeAt ?? at + 1;
        return labels.join(".").toLowerCase();
      }
      if (len >= pointerTag) {
        resumeAt ??= at + uint16Bytes;
        at = (len - pointerTag) * byteValues + this.byteAt(at + 1);
      } else {
        labels.push(decoder.decode(this.slice(at + 1, len)));
        at += len + 1;
      }
    }
    throw new MalformedResponse({ reason: "name compression loop" });
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
