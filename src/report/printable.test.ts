import { describe, expect, test } from "bun:test";
import { printable } from "./printable.ts";

const mark = "�";
const esc = "\u001B";
const bell = "\u0007";
const csi = "\u009B";
const nul = "\u0000";

describe("printable", () => {
  test("leaves ordinary text alone", () => {
    expect(printable("blokkert.example → 0.0.0.0\tok\n")).toBe(
      "blokkert.example → 0.0.0.0\tok\n"
    );
  });

  test("replaces escape sequences and other control characters", () => {
    expect(printable(`a${esc}[2Jb${bell}c${csi}d${nul}`)).toBe(
      `a${mark}[2Jb${mark}c${mark}d${mark}`
    );
  });

  test("replaces bidi controls", () => {
    expect(printable("x‮y⁦z")).toBe(`x${mark}y${mark}z`);
  });
});
