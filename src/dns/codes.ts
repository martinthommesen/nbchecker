/** DNS response codes and Extended DNS Errors, with their names. */

/** The response codes that filters and resolvers answer with. */
const Rcode = {
  formErr: 1,
  noError: 0,
  notImp: 4,
  nxDomain: 3,
  refused: 5,
  servFail: 2,
} as const;

/** The Extended DNS Error (RFC 8914) info codes that filters use. */
const Ede = {
  blocked: 15,
  censored: 16,
  filtered: 17,
  prohibited: 18,
} as const;

const rcodeNames = new Map<number, string>([
  [Rcode.noError, "NOERROR"],
  [Rcode.formErr, "FORMERR"],
  [Rcode.servFail, "SERVFAIL"],
  [Rcode.nxDomain, "NXDOMAIN"],
  [Rcode.notImp, "NOTIMP"],
  [Rcode.refused, "REFUSED"],
]);

const extendedErrorNames = new Map<number, string>([
  [Ede.blocked, "Blocked"],
  [Ede.censored, "Censored"],
  [Ede.filtered, "Filtered"],
  [Ede.prohibited, "Prohibited"],
]);

/** The Extended DNS Errors that mean the name was blocked. */
const blockingCodes: ReadonlySet<number> = new Set([
  Ede.blocked,
  Ede.censored,
  Ede.filtered,
]);

/** A response code's name, such as REFUSED. */
const rcodeName = (code: number): string =>
  rcodeNames.get(code) ?? `RCODE ${code}`;

/** An Extended DNS Error's name, such as Blocked. */
const extendedErrorName = (code: number): string | undefined =>
  extendedErrorNames.get(code);

/** Whether an Extended DNS Error says the name was blocked. */
const isBlockingError = (code: number): boolean => blockingCodes.has(code);

export { Ede, extendedErrorName, isBlockingError, Rcode, rcodeName };
