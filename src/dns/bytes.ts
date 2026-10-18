/** Builds DNS messages from parts, and frames them for DNS over TCP. */
import { uint16Bytes } from "./protocol.ts";

/** DNS over TCP sends each message after its length, as a uint16. */
const lengthPrefixBytes = uint16Bytes;

/** Joins byte arrays into one. */
export const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** Writes 16-bit numbers in network byte order. */
export const uint16s = (...values: readonly number[]): Uint8Array => {
  const out = new Uint8Array(values.length * uint16Bytes);
  const view = new DataView(out.buffer);
  for (const [i, v] of values.entries()) {
    view.setUint16(i * uint16Bytes, v);
  }
  return out;
};

/** Prefixes a message with its length, as DNS over TCP needs. */
export const frame = (message: Uint8Array): Uint8Array =>
  concat([uint16s(message.length), message]);

/** Returns the framed message once all of it has arrived. */
export const unframe = (received: Uint8Array): Uint8Array | undefined => {
  if (received.length < lengthPrefixBytes) {
    return;
  }
  const want = new DataView(received.buffer, received.byteOffset).getUint16(0);
  if (received.length < want + lengthPrefixBytes) {
    return;
  }
  return received.subarray(lengthPrefixBytes, want + lengthPrefixBytes);
};
