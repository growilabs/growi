import yauzl, { type Entry, type ZipFile } from 'yauzl';

import { ConversionError } from '../conversion-error';
import { entryName } from './zip-entry-name';
import { STRONG_ENCRYPTION_FLAG, zipExtent } from './zip-extent';

// CPython's zipfile refuses to open an archive with an entry needing a newer
// version to extract.
const MAX_EXTRACT_VERSION = 63;

export interface ListedEntry {
  readonly name: string;
  readonly raw: Entry;
  /** The general purpose flags as stored, including any yauzl was shown without. */
  readonly flags: number;
}

export interface OpenedZip {
  readonly zip: ZipFile;
  readonly strongEncryption: ReadonlySet<number>;
}

const unlistable = (): ConversionError =>
  new ConversionError('malformed', 'archive directory cannot be read');

/**
 * null when the bytes are not a ZIP; rejects with `malformed` when they are
 * one that yauzl cannot open.
 */
export const openZip = (bytes: Uint8Array): Promise<OpenedZip | null> => {
  const extent = zipExtent(bytes);
  if (extent == null) {
    return Promise.resolve(null);
  }
  const { bytes: view, strongEncryption } = extent;
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      Buffer.from(view.buffer, view.byteOffset, view.byteLength),
      {
        lazyEntries: true,
        // Names such as "../x" make yauzl refuse the whole archive when it decodes them.
        decodeStrings: false,
        // Checked per part as it is read (zip-part-stream.ts): yauzl's check
        // refuses the whole listing over one stored entry whose sizes differ,
        // where CPython fails only a read of that entry.
        validateEntrySizes: false,
        autoClose: false,
      },
      (error, zip) =>
        error == null
          ? resolve({ zip, strongEncryption })
          : reject(unlistable()),
    );
  });
};

/**
 * Reads the central directory, stopping as soon as it holds more than
 * `maxEntries` entries so a hostile directory is never held whole. Rejects
 * with `limit_exceeded` past that count, and with `malformed` at the first
 * entry that cannot be read.
 */
export const listEntries = (
  { zip, strongEncryption }: OpenedZip,
  maxEntries: number,
): Promise<readonly ListedEntry[]> =>
  new Promise((resolve, reject) => {
    const entries: ListedEntry[] = [];
    // Stays attached: yauzl may still report a reader error after the listing ended.
    zip.on('error', () => reject(unlistable()));
    zip.on('end', () => resolve(entries));
    zip.on('entry', (raw: Entry) => {
      const name = entryName(raw);
      if (
        name == null ||
        (raw.versionNeededToExtract & 0xff) > MAX_EXTRACT_VERSION
      ) {
        reject(unlistable());
        return;
      }
      const strong = strongEncryption.has(entries.length);
      const flags =
        raw.generalPurposeBitFlag | (strong ? STRONG_ENCRYPTION_FLAG : 0);
      entries.push({ name, raw, flags });
      if (entries.length > maxEntries) {
        reject(
          new ConversionError('limit_exceeded', 'archive has too many entries'),
        );
        return;
      }
      zip.readEntry();
    });
    zip.readEntry();
  });
