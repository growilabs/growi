// Bytes -> string for OOXML parts, accepting what expat (behind defusedxml)
// accepts: UTF-16 (a BOM, or "<" as the first code unit), UTF-8, US-ASCII,
// ISO-8859-1 and the other single-byte code pages. Multi-byte code pages,
// unknown names and a declaration contradicting UTF-16 are refused.

const DECLARATION = /^<\?xml\b[^>]*?\bencoding\s*=\s*(["'])([^"']*)\1/;
// Only the head is searched, so a hostile part never makes this scan long.
const HEAD_CHARS = 200;

// WHATWG single-byte decoders; expat takes any single-byte codec Python has.
const SINGLE_BYTE = new Set([
  'ibm866',
  'iso-8859-2',
  'iso-8859-3',
  'iso-8859-4',
  'iso-8859-5',
  'iso-8859-6',
  'iso-8859-7',
  'iso-8859-8',
  'iso-8859-10',
  'iso-8859-13',
  'iso-8859-14',
  'iso-8859-15',
  'iso-8859-16',
  'koi8-r',
  'koi8-u',
  'macintosh',
  'windows-874',
  'windows-1250',
  'windows-1251',
  'windows-1252',
  'windows-1253',
  'windows-1254',
  'windows-1255',
  'windows-1256',
  'windows-1257',
  'windows-1258',
  'x-mac-cyrillic',
]);
// Python's ascii, not WHATWG's (where these labels mean windows-1252).
const ASCII_NAMES = new Set(['us-ascii', 'ascii', 'ansi_x3.4-1968']);
// Every WHATWG label of windows-1252 that Python resolves to latin-1.
const LATIN1_NAMES = new Set([
  'iso-8859-1',
  'iso8859-1',
  'iso_8859-1',
  'latin1',
  'latin-1',
  'l1',
  'cp819',
  'ibm819',
  'csisolatin1',
  'iso-ir-100',
]);
// WHATWG decodes the bytes Python's cp125x leaves undefined as C1 controls.
const UNDEFINED_IN_PYTHON = /[\u0080-\u009f]/;

class XmlDecodeError extends Error {}

const strict = (label: string, bytes: Uint8Array): string => {
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes);
  } catch {
    throw new XmlDecodeError(`not valid ${label}`);
  }
};

const declaredIn = (head: string): string | null =>
  DECLARATION.exec(head)?.[2].toLowerCase() ?? null;

const utf16Of = (b: Uint8Array): 'utf-16le' | 'utf-16be' | null => {
  if ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0x3c && b[1] === 0x00)) {
    return 'utf-16le';
  }
  if ((b[0] === 0xfe && b[1] === 0xff) || (b[0] === 0x00 && b[1] === 0x3c)) {
    return 'utf-16be';
  }
  return null;
};

const decodeUtf16 = (bytes: Uint8Array, label: string): string => {
  const text = strict(label, bytes);
  const declared = declaredIn(text.slice(0, HEAD_CHARS));
  if (declared != null && declared !== 'utf-16' && declared !== label) {
    throw new XmlDecodeError('declaration contradicts UTF-16');
  }
  return text;
};

const decodeDeclared = (body: Uint8Array, declared: string): string => {
  if (declared === 'utf-8' || declared === 'utf8') {
    return strict('utf-8', body);
  }
  if (ASCII_NAMES.has(declared)) {
    if (body.some((b) => b >= 0x80)) {
      throw new XmlDecodeError('non-ASCII byte');
    }
    return strict('utf-8', body);
  }
  if (LATIN1_NAMES.has(declared)) {
    return Buffer.from(body).toString('latin1');
  }
  let label: string | null = null;
  try {
    label = new TextDecoder(declared).encoding;
  } catch {
    // not a WHATWG label
  }
  if (label == null || !SINGLE_BYTE.has(label)) {
    throw new XmlDecodeError('unsupported XML encoding');
  }
  const text = strict(label, body);
  if (label.startsWith('windows-125') && UNDEFINED_IN_PYTHON.test(text)) {
    throw new XmlDecodeError(`byte undefined in ${label}`);
  }
  return text;
};

const decodeOrThrow = (bytes: Uint8Array): string => {
  const utf16 = utf16Of(bytes);
  if (utf16 != null) {
    return decodeUtf16(bytes, utf16);
  }
  // After a UTF-8 BOM expat still decodes the rest with the declared encoding.
  const body =
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? bytes.subarray(3)
      : bytes;
  const head = Buffer.from(
    body.buffer,
    body.byteOffset,
    Math.min(body.byteLength, HEAD_CHARS),
  ).toString('latin1');
  return decodeDeclared(body, declaredIn(head) ?? 'utf-8');
};

/** The part's text, or null when expat would refuse its bytes or declared encoding. */
export const decodeXmlPart = (bytes: Uint8Array): string | null => {
  try {
    return decodeOrThrow(bytes);
  } catch (error) {
    if (error instanceof XmlDecodeError) {
      return null;
    }
    throw error;
  }
};
