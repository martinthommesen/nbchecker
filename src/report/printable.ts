/**
 * Makes text from the network safe to show in a terminal. DNS names, EDE
 * text and error messages can hold control characters, which a terminal
 * would act on instead of showing.
 */

const replacement = "�";
const tab = 0x09;
const lastC0 = 0x1f;
const firstC1 = 0x7f;
const lastC1 = 0x9f;
const firstEmbedding = 0x20_2a;
const lastEmbedding = 0x20_2e;
const firstIsolate = 0x20_66;
const lastIsolate = 0x20_69;

const between = (code: number, low: number, high: number): boolean =>
  code >= low && code <= high;

/**
 * Control characters, newlines included so text can't add lines of its own,
 * and the bidi controls that can reorder what is shown.
 */
const unsafe = (code: number): boolean => {
  if (code === tab) {
    return false;
  }
  return (
    code <= lastC0 ||
    between(code, firstC1, lastC1) ||
    between(code, firstEmbedding, lastEmbedding) ||
    between(code, firstIsolate, lastIsolate)
  );
};

/** Replaces characters a terminal would act on with "�". */
export const printable = (text: string): string => {
  let out = "";
  for (const char of text) {
    if (unsafe(char.codePointAt(0) ?? 0)) {
      out += replacement;
    } else {
      out += char;
    }
  }
  return out;
};
