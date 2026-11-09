import yauzl, { type Entry, type ZipFile } from 'yauzl';

import { entryName } from './zip-entry-name';
import { STRONG_ENCRYPTION_FLAG, zipExtent } from './zip-extent';

// CPython's zipfile refuses to open an archive with an entry needing a newer
// version to extract; the Python service then hands the bytes to anydoc whole.
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

export type Listing =
  | { readonly kind: 'listed'; readonly entries: readonly ListedEntry[] }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'too-many' };

/** null when the bytes are not a ZIP CPython and yauzl can open. */
export const openZip = (bytes: Uint8Array): Promise<OpenedZip | null> => {
  const extent = zipExtent(bytes);
  if (extent == null) {
    return Promise.resolve(null);
  }
  const { bytes: view, strongEncryption } = extent;
  return new Promise((resolve) => {
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
      (error, zip) => resolve(error == null ? { zip, strongEncryption } : null),
    );
  });
};

/**
 * Reads the central directory, stopping as soon as it holds more than
 * `maxEntries` entries so a hostile directory is never held whole.
 */
export const listEntries = (
  { zip, strongEncryption }: OpenedZip,
  maxEntries: number,
): Promise<Listing> =>
  new Promise((resolve) => {
    const entries: ListedEntry[] = [];
    // Stays attached: yauzl may still report a reader error after the listing ended.
    zip.on('error', () => resolve({ kind: 'unreadable' }));
    zip.on('end', () => resolve({ kind: 'listed', entries }));
    zip.on('entry', (raw: Entry) => {
      const name = entryName(raw);
      if (
        name == null ||
        (raw.versionNeededToExtract & 0xff) > MAX_EXTRACT_VERSION
      ) {
        resolve({ kind: 'unreadable' });
        return;
      }
      const strong = strongEncryption.has(entries.length);
      const flags =
        raw.generalPurposeBitFlag | (strong ? STRONG_ENCRYPTION_FLAG : 0);
      entries.push({ name, raw, flags });
      if (entries.length > maxEntries) {
        resolve({ kind: 'too-many' });
        return;
      }
      zip.readEntry();
    });
    zip.readEntry();
  });
