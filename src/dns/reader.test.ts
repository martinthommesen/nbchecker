import { describe, expect, test } from "bun:test";
import { Reader } from "./reader.ts";

const encoder = new TextEncoder();
const pointerTag = 0xc0;
const manyLabels = 33;
const longestLabel = 63;
const tooLongLabel = 64;
/** Four 63-byte labels take 257 bytes, two more than a name may. */
const labelsPastLimit = 4;

const labels = (...names: readonly string[]): number[] =>
  names.flatMap((l) => [l.length, ...encoder.encode(l)]);

const pointer = (to: number): number[] => [pointerTag, to];

const readName = (bytes: readonly number[], from = 0): string => {
  const r = new Reader(Uint8Array.from(bytes));
  r.offset = from;
  return r.name();
};

const nameError = (bytes: readonly number[], from = 0): string => {
  try {
    readName(bytes, from);
  } catch (error) {
    return (error as { readonly reason: string }).reason;
  }
  return "no error";
};

const ones = (n: number): string[] => Array.from({ length: n }, () => "a");

describe("Reader.name", () => {
  test("reads a name with many labels", () => {
    const parts = ones(manyLabels);
    expect(readName([...labels(...parts), 0])).toBe(parts.join("."));
  });

  test("reads a name with many labels through a pointer", () => {
    const parts = ones(manyLabels);
    // "b" at offset 0, then 33 labels that end by pointing at it.
    const bytes = [...labels("b"), 0, ...labels(...parts), ...pointer(0)];
    const start = 3;
    expect(readName(bytes, start)).toBe([...parts, "b"].join("."));
  });

  test("leaves the offset after the pointer", () => {
    const r = new Reader(Uint8Array.from([...labels("b"), 0, ...pointer(0)]));
    const start = 3;
    const after = 5;
    r.offset = start;
    expect(r.name()).toBe("b");
    expect(r.offset).toBe(after);
  });

  test("fails on a pointer cycle", () => {
    expect(nameError(pointer(0))).toBe("name compression loop");
    const two = 2;
    expect(nameError([...pointer(two), ...pointer(0)])).toBe(
      "name compression loop"
    );
  });

  test("fails on a name longer than 255 bytes", () => {
    const label = "a".repeat(longestLabel);
    const parts = Array.from({ length: labelsPastLimit }, () => label);
    expect(nameError([...labels(...parts), 0])).toBe("name is too long");
  });

  test("counts the labels a pointer leads to towards the 255 bytes", () => {
    const label = "a".repeat(longestLabel);
    // Three labels (192 bytes) and their end, then one more label and a
    // pointer back to them: 64 + 192 + 1 bytes once expanded.
    const target = [...labels(label, label, label), 0];
    const prefixed = [...labels(label), ...pointer(0)];
    expect(nameError([...target, ...prefixed], target.length)).toBe(
      "name is too long"
    );
  });

  test("fails on a label longer than 63 bytes", () => {
    expect(nameError([...labels("a".repeat(tooLongLabel)), 0])).toBe(
      "bad label length"
    );
  });
});
