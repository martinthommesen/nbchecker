/**
 * Checks that a reply answers the query it was sent for: the ID, the QR bit,
 * the opcode and the question (RFC 5452).
 */
import { Rcode } from "./codes.ts";
import { MalformedResponse } from "./malformed.ts";
import { headerLength } from "./protocol.ts";
import { type Header, Reader } from "./reader.ts";

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

interface Message extends Header {
  /** The first question as name, type and class, if there is one. */
  readonly question: string | undefined;
}

const read = (bytes: Uint8Array): Message => {
  // A reply without a whole header can't be checked, even an empty one.
  if (bytes.length < headerLength) {
    throw new MalformedResponse({ reason: "bad answer: header cut short" });
  }
  const r = new Reader(bytes);
  const header = r.header();
  if (header.questions === 0) {
    return { ...header, question: undefined };
  }
  const { dnsClass, name, type } = r.question();
  return { ...header, question: `${name} ${type} ${dnsClass}` };
};

const questionMatches = (query: Message, reply: Message): boolean => {
  if (reply.questions === 0) {
    return questionlessRcodes.has(reply.rcode);
  }
  return reply.questions === 1 && reply.question === query.question;
};

const compare = (query: Message, reply: Message): string | undefined => {
  if (reply.id !== query.id) {
    return "answer was for a different query";
  }
  if (!reply.isResponse) {
    return "bad answer: not a response";
  }
  if (reply.opcode !== query.opcode) {
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
