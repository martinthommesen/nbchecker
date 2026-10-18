/**
 * Checks that a reply answers the query it was sent for: the ID, the QR bit,
 * the opcode and the question (RFC 5452).
 */

import { Rcode } from "./codes.ts";
import { MalformedResponse } from "./malformed.ts";
import { Reader } from "./reader.ts";

const headerLength = 12;
const flagResponse = 0x80_00;
/** The opcode sits above the AA, TC, RD, RA, Z and rcode bits. */
const opcodeDivisor = 0x8_00;
const opcodeValues = 16;
const rcodeValues = 16;
const notMatching = "bad answer: question doesn't match";

/**
 * Error rcodes that a server may send with an empty question section, as
 * when it can't parse the query (FORMERR, SERVFAIL, NOTIMP, REFUSED).
 */
const questionlessRcodes: ReadonlySet<number> = new Set([
  Rcode.formErr,
  Rcode.servFail,
  Rcode.notImp,
  Rcode.refused,
]);

interface Message {
  readonly flags: number;
  readonly id: number;
  /** The first question as name, type and class, if there is one. */
  readonly question: string | undefined;
  readonly questions: number;
}

const read = (bytes: Uint8Array): Message => {
  // A reply without a whole header can't be checked, even an empty one.
  if (bytes.length < headerLength) {
    throw new MalformedResponse({ reason: "bad answer: header cut short" });
  }
  const r = new Reader(bytes);
  const id = r.u16();
  const flags = r.u16();
  const questions = r.u16();
  if (questions === 0) {
    return { flags, id, question: undefined, questions };
  }
  r.offset = headerLength;
  const name = r.name();
  const question = `${name} ${r.u16()} ${r.u16()}`;
  return { flags, id, question, questions };
};

const isResponse = (m: Message): boolean =>
  Math.floor(m.flags / flagResponse) === 1;

const opcode = (m: Message): number =>
  Math.floor(m.flags / opcodeDivisor) % opcodeValues;

const questionMatches = (query: Message, reply: Message): boolean => {
  if (reply.questions === 0) {
    return questionlessRcodes.has(reply.flags % rcodeValues);
  }
  return reply.questions === 1 && reply.question === query.question;
};

const compare = (query: Message, reply: Message): string | undefined => {
  if (reply.id !== query.id) {
    return "answer was for a different query";
  }
  if (!isResponse(reply)) {
    return "bad answer: not a response";
  }
  if (opcode(reply) !== opcode(query)) {
    return "bad answer: wrong opcode";
  }
  if (questionMatches(query, reply)) {
    return;
  }
  return notMatching;
};

/** Says why `reply` doesn't answer `query`, or undefined when it does. */
export const mismatch = (
  query: Uint8Array,
  reply: Uint8Array
): string | undefined => {
  try {
    return compare(read(query), read(reply));
  } catch (error) {
    if (error instanceof MalformedResponse) {
      return error.reason;
    }
    throw error;
  }
};
