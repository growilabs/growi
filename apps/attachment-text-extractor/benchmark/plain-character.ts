const WHITESPACE_OR_PRINTABLE_ASCII = /[\s\x20-\x7e]/u;
const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);

/**
 * Whitespace or printable ASCII: characters the mojibake count ignores
 * (research.md 12.3). JavaScript's \s includes U+FEFF, but a byte order mark
 * left in extracted text is a defect, so it is not plain.
 */
export const isPlainCharacter = (char: string): boolean =>
  char !== BYTE_ORDER_MARK && WHITESPACE_OR_PRINTABLE_ASCII.test(char);
