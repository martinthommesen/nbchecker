/** Names for DNS response codes and Extended DNS Errors, kept in one place. */
import { Rcode } from "../dns/wire.ts";

const formErr = 1;
const notImp = 4;
const rcodeNames = new Map<number, string>([
  [Rcode.noError, "NOERROR"],
  [formErr, "FORMERR"],
  [Rcode.servFail, "SERVFAIL"],
  [Rcode.nxDomain, "NXDOMAIN"],
  [notImp, "NOTIMP"],
  [Rcode.refused, "REFUSED"],
]);

/** Extended DNS Error codes (RFC 8914) that filters use. */
const edeBlocked = 15;
const edeCensored = 16;
const edeFiltered = 17;
const edeProhibited = 18;
const extendedErrorNames = new Map<number, string>([
  [edeBlocked, "Blocked"],
  [edeCensored, "Censored"],
  [edeFiltered, "Filtered"],
  [edeProhibited, "Prohibited"],
]);

/** The Extended DNS Errors that mean the name was blocked. */
const blockingCodes: ReadonlySet<number> = new Set([
  edeBlocked,
  edeCensored,
  edeFiltered,
]);

/** A response code's name, such as REFUSED. */
export const rcodeName = (code: number): string =>
  rcodeNames.get(code) ?? `RCODE ${code}`;

/** An Extended DNS Error's name, such as Blocked. */
export const extendedErrorName = (code: number): string | undefined =>
  extendedErrorNames.get(code);

/** Whether an Extended DNS Error says the name was blocked. */
export const isBlockingError = (code: number): boolean =>
  blockingCodes.has(code);
