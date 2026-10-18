/**
 * The DNS wire format's numbers (RFC 1035, RFC 6891, RFC 8914), kept in one
 * place for the codec and the test messages built from it.
 */

/** The record types the codec writes or reads. */
export const RecordType = { a: 1, aaaa: 28, cname: 5, opt: 41 } as const;

/** The Internet class, the only one asked about. */
export const classIn = 1;

/** The header: an ID, the flags and four section counts. */
export const headerLength = 12;

/** Header flag bits. */
export const Flag = {
  recursionDesired: 0x01_00,
  response: 0x80_00,
  truncated: 0x02_00,
} as const;

/** The header's rcode field is four bits wide: 16 values. */
export const rcodeValues = 16;

/** Where the rest of the rcode sits: the top byte of the OPT record's TTL. */
export const extendedRcodeUnit = 2 ** 24;

/** The EDNS option that carries an Extended DNS Error. */
export const extendedErrorOption = 15;

/** Labels are at most 63 bytes; length bytes 0x40 to 0xbf are reserved. */
export const maxLabelLength = 63;

export const uint16Bytes = 2;
export const uint32Bytes = 4;
