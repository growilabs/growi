import type { ConversionLimits } from '../../contract';
import { ConversionError } from '../conversion-error';
import type { ArchiveEntry, OoxmlArchive } from './archive-guard';
import { scanCells } from './xlsx-cell-scan';

// anydoc finds sheets through workbook.xml.rels, so a sheet may sit at any
// path, with any name or extension: every part but relationship files is
// scanned, each copy of a duplicated name included.
const isScanned = (entry: ArchiveEntry): boolean =>
  !entry.isDirectory && !entry.name.toLowerCase().endsWith('.rels');

/**
 * limit_exceeded when the worksheets together hold more than maxXlsxCells
 * cells. Inflation is bounded by the archive size limit, counted on the bytes
 * actually produced rather than the declared sizes.
 */
export const enforceCellLimit = async (
  archive: OoxmlArchive,
  limits: Pick<
    ConversionLimits,
    'maxXlsxCells' | 'maxArchiveUncompressedBytes'
  >,
): Promise<void> => {
  let cells = 0;
  let budget = limits.maxArchiveUncompressedBytes;
  for (const entry of archive.entries.filter(isScanned)) {
    // biome-ignore lint/performance/noAwaitInLoops: one part at a time keeps memory flat
    for await (const chunk of scanCells(await archive.openEntry(entry))) {
      cells += chunk.cells;
      budget -= chunk.bytes;
      if (cells > limits.maxXlsxCells) {
        throw new ConversionError(
          'limit_exceeded',
          'workbook has too many cells',
        );
      }
      if (budget < 0) {
        throw new ConversionError(
          'limit_exceeded',
          'worksheets expand beyond the size limit',
        );
      }
    }
  }
};
