// Only the first bytes are scanned: a document declares its charset in its
// head, and the bound keeps the patterns cheap on hostile input. The patterns
// mirror the Python service's byte regexes, whose \s is ASCII whitespace only
// (JS \s would also match a latin-1 0xA0).
const META_SCAN_BYTES = 4096;
const META_CHARSET =
  /<meta\b[^>]*?charset[ \t\n\r\f\v]*=[ \t\n\r\f\v]*["']?[ \t\n\r\f\v]*([A-Za-z0-9_.:-]{1,64})/i;
const XML_DECLARATION_SCAN_BYTES = 256;
const XML_ENCODING =
  /^[ \t\n\r\f\v]*<\?xml\b[^>]*?encoding[ \t\n\r\f\v]*=[ \t\n\r\f\v]*["']([A-Za-z0-9_.:-]{1,64})["']/i;

// The name was just read as ASCII, so a UTF-16/32 declaration is wrong
// (browsers treat it as UTF-8).
const WIDE_UNICODE = /^(?:utf-16|utf-32|ucs-)/;

const declaredIn = (
  bytes: Uint8Array,
  scanBytes: number,
  pattern: RegExp,
): string | null => {
  const head = Buffer.from(
    bytes.buffer,
    bytes.byteOffset,
    Math.min(bytes.byteLength, scanBytes),
  ).toString('latin1');
  const name = pattern.exec(head)?.[1];
  if (name === undefined) {
    return null;
  }
  return WIDE_UNICODE.test(name.toLowerCase().replaceAll('_', '-'))
    ? 'utf-8'
    : name;
};

/** The charset named by a <meta> in the first 4 KiB of an HTML document. */
export const htmlDeclaredCharset = (bytes: Uint8Array): string | null =>
  declaredIn(bytes, META_SCAN_BYTES, META_CHARSET);

/** The encoding named by the XML declaration at the start of a document. */
export const xmlDeclaredEncoding = (bytes: Uint8Array): string | null =>
  declaredIn(bytes, XML_DECLARATION_SCAN_BYTES, XML_ENCODING);
