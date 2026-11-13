import { Readable, Transform, type TransformCallback } from 'node:stream';
import { ZipFile } from 'yazl';

import { ConversionError } from '../conversion-error';
import type { ArchiveEntry, OoxmlArchive } from './archive-guard';
import { isWritableEntryName } from './zip-entry-writable';
import { createZipOutput, type ZipOutput } from './zip-output';
import { bufferChunk, unreadablePart } from './zip-part-stream';
import { PACKAGE_MTIME, type PackagePart } from './zip-writer';

const classified = (error: unknown): ConversionError =>
  error instanceof ConversionError ? error : unreadablePart();

/**
 * One entry per name, in first-occurrence order, each holding the last copy
 * of its name: what CPython's zipfile (and anydoc) read for a duplicate.
 */
const distinctEntries = (entries: readonly ArchiveEntry[]): ArchiveEntry[] => {
  const last = new Map(entries.map((entry) => [entry.name, entry]));
  return [...new Set(entries.map((entry) => entry.name))].flatMap((name) => {
    const entry = last.get(name);
    return entry == null ? [] : [entry];
  });
};

/** Passes bytes through while a shared budget lasts; counted as produced, never from the headers. */
const budgetGate = (spend: (bytes: number) => boolean): Transform =>
  new Transform({
    transform(chunk: unknown, _encoding, next: TransformCallback) {
      const bytes = bufferChunk(chunk);
      if (!spend(bytes.length)) {
        next(
          new ConversionError(
            'limit_exceeded',
            'archive parts expand beyond the size limit',
          ),
        );
        return;
      }
      next(null, bytes);
    },
  });

interface CopyContext {
  readonly archive: OoxmlArchive;
  readonly output: ZipOutput;
  readonly spend: (bytes: number) => boolean;
}

const copiedEntry = (
  { archive, output, spend }: CopyContext,
  entry: ArchiveEntry,
  done: (error: unknown, stream: NodeJS.ReadableStream) => void,
): void => {
  const opened = output.failed()
    ? Promise.reject(unreadablePart())
    : archive.openEntry(entry);
  opened.then(
    (source) => {
      const gate = budgetGate(spend);
      // pipe() forwards neither failure: a read error fails the gate, and a
      // failed gate stops the read and the whole output (yazl does not
      // forward a source failure to its output, which would never end).
      source.on('error', (error) => gate.destroy(classified(error)));
      gate.on('error', (error) => {
        source.destroy();
        output.fail(classified(error));
      });
      done(null, source.pipe(gate));
    },
    (error: unknown) => done(classified(error), Readable.from([])),
  );
};

/**
 * The archive rewritten for anydoc with `replaced` swapped in, every other
 * part streamed from the source without being held whole. Entries a ZIP
 * writer cannot name (directories, "../x", "/x", "C:/x") are left out.
 */
export const repackage = (
  archive: OoxmlArchive,
  replaced: PackagePart,
  budgetBytes: number,
): Promise<Buffer> => {
  let budget = budgetBytes;
  const spend = (bytes: number): boolean => {
    budget -= bytes;
    return budget >= 0;
  };
  const output = createZipOutput(new ZipFile());
  const context = { archive, output, spend };
  try {
    for (const entry of distinctEntries(archive.entries)) {
      if (!isWritableEntryName(entry.name)) {
        continue;
      }
      const options = { compress: entry.compressed, mtime: PACKAGE_MTIME };
      output.zip.addReadStreamLazy(entry.name, options, (done) => {
        if (entry.name === replaced.name) {
          done(null, Readable.from([replaced.body], { objectMode: false }));
          return;
        }
        copiedEntry(context, entry, done);
      });
    }
  } catch (error) {
    // Earlier entries may already be streaming: finish() still drains the
    // output, so their later failures have a listener.
    output.fail(error);
  }
  return output.finish();
};
