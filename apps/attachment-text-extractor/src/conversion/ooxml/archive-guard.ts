import type { Readable } from 'node:stream';
import type { ZipFile } from 'yauzl';

import type { ConversionLimits } from '../../contract';
import { ConversionError } from '../conversion-error';
import {
  type ListedEntry,
  type Listing,
  listEntries,
  openZip,
} from './zip-directory';
import { collectPart, openPartStream, unreadablePart } from './zip-part-stream';

export type ArchiveLimits = Pick<
  ConversionLimits,
  'maxArchiveEntries' | 'maxArchiveUncompressedBytes'
>;

export interface ArchiveEntry {
  readonly name: string;
  readonly declaredSize: number;
  readonly isDirectory: boolean;
  /** False for a stored entry; a rewritten package keeps the method. */
  readonly compressed: boolean;
}

export interface OoxmlArchive {
  /** In central directory order, duplicate names included. */
  readonly entries: readonly ArchiveEntry[];
  readPart(name: string, maxBytes: number): Promise<Buffer>;
  openEntry(entry: ArchiveEntry): Promise<Readable>;
  close(): void;
}

/** The listed entries, or null when the archive goes to anydoc untouched. */
const withinLimits = (
  listing: Listing,
  limits: ArchiveLimits,
): readonly ListedEntry[] | null => {
  if (listing.kind === 'unreadable') {
    return null;
  }
  if (listing.kind === 'too-many') {
    throw new ConversionError('limit_exceeded', 'archive has too many entries');
  }
  const declared = listing.entries.reduce(
    (sum, { raw }) => sum + raw.uncompressedSize,
    0,
  );
  if (declared > limits.maxArchiveUncompressedBytes) {
    throw new ConversionError(
      'limit_exceeded',
      'archive expands beyond the size limit',
    );
  }
  return listing.entries;
};

const toArchive = (
  zip: ZipFile,
  listed: readonly ListedEntry[],
): OoxmlArchive => {
  const pairs = listed.map((item): [ArchiveEntry, ListedEntry] => {
    const { name, raw } = item;
    const entry = {
      name,
      declaredSize: raw.uncompressedSize,
      // CPython's ZipInfo.is_dir().
      isDirectory: name.endsWith('/'),
      compressed: raw.compressionMethod !== 0,
    };
    return [entry, item];
  });
  const listedOf = new Map(pairs);
  const entries = pairs.map(([entry]) => entry);
  // Of duplicated names the last entry wins, as in CPython's zipfile.
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  let closed = false;

  const openEntry = (entry: ArchiveEntry): Promise<Readable> => {
    const item = listedOf.get(entry);
    return closed || item == null
      ? Promise.reject(unreadablePart())
      : openPartStream(zip, item.raw, item.flags);
  };

  return {
    entries,
    openEntry,
    readPart: async (name, maxBytes) => {
      const entry = byName.get(name);
      if (entry == null) {
        throw new ConversionError('malformed', 'archive part is missing');
      }
      return collectPart(await openEntry(entry), maxBytes);
    },
    close: () => {
      closed = true;
      zip.close();
    },
  };
};

/**
 * Reads only the central directory; part data is read on demand. null when the
 * bytes are not a ZIP holding `requiredPart` exactly once (the caller hands
 * them to anydoc whole). The caller owns and must close the returned archive.
 */
export const inspectArchive = async (
  bytes: Uint8Array,
  requiredPart: string,
  limits: ArchiveLimits,
): Promise<OoxmlArchive | null> => {
  const opened = await openZip(bytes);
  if (opened == null) {
    return null;
  }
  const { zip } = opened;
  try {
    const listed = withinLimits(
      await listEntries(opened, limits.maxArchiveEntries),
      limits,
    );
    // A duplicated name is ambiguous between readers, so it is left to anydoc.
    if (listed?.filter(({ name }) => name === requiredPart).length === 1) {
      return toArchive(zip, listed);
    }
  } catch (error) {
    zip.close();
    throw error;
  }
  zip.close();
  return null;
};
