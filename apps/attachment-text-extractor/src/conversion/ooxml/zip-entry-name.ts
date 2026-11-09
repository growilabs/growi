import { crc32 } from 'node:zlib';
import type { Entry } from 'yauzl';

const UTF8_NAME_FLAG = 0x800;
const UNICODE_PATH_FIELD = 0x7075;
const UNICODE_PATH_HEADER_BYTES = 5;

// ignoreBOM keeps a leading U+FEFF, as Python's utf-8 codec does.
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const strictUtf8 = (bytes: Uint8Array): string | null => {
  try {
    return UTF8.decode(bytes);
  } catch {
    return null;
  }
};

// CPython ends a name at its first NUL (zipfile._sanitize_filename).
const sanitized = (name: string): string => {
  const nul = name.indexOf('\u0000');
  return nul < 0 ? name : name.slice(0, nul);
};

/** The Info-ZIP Unicode Path field as CPython reads it: undefined when absent or unused, null when corrupt. */
const unicodePath = (raw: Entry): string | null | undefined => {
  let found: string | null | undefined;
  for (const field of raw.extraFields) {
    if (field.id !== UNICODE_PATH_FIELD) {
      continue;
    }
    if (field.data.length < UNICODE_PATH_HEADER_BYTES) {
      return null;
    }
    if (
      field.data[0] === 1 &&
      field.data.readUInt32LE(1) === crc32(raw.fileNameRaw)
    ) {
      const name = strictUtf8(field.data.subarray(UNICODE_PATH_HEADER_BYTES));
      if (name == null) {
        return null;
      }
      found = name === '' ? found : name;
    }
  }
  return found;
};

/**
 * The entry name as the Python service's zipfile sees it, except that a name
 * without the UTF-8 flag is read as latin-1 rather than cp437 (research.md
 * 18.7 item 7). null when CPython would refuse to open the archive.
 */
export const entryName = (raw: Entry): string | null => {
  const stored =
    (raw.generalPurposeBitFlag & UTF8_NAME_FLAG) === 0
      ? raw.fileNameRaw.toString('latin1')
      : strictUtf8(raw.fileNameRaw);
  const override = unicodePath(raw);
  if (stored == null || override === null) {
    return null;
  }
  return sanitized(override ?? stored);
};
