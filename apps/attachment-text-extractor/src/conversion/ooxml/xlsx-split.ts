import type { ConversionLimits, PageInfo } from '../../contract';
import { convertOffice } from '../office';
import { inspectArchive, type OoxmlArchive } from './archive-guard';
import { enforceCellLimit } from './xlsx-cell-count';
import { markSheets, newMarkerToken } from './xlsx-markers';
import { repackage } from './xlsx-repackage';
import { splitByMarkers } from './xlsx-sections';

const WORKBOOK = 'xl/workbook.xml';

interface MarkedPackage {
  readonly bytes: Buffer;
  readonly names: readonly (string | null)[];
}

const markedPackage = async (
  archive: OoxmlArchive,
  token: string,
  limits: ConversionLimits,
): Promise<MarkedPackage> => {
  const budget = limits.maxArchiveUncompressedBytes;
  const workbook = await archive.readPart(WORKBOOK, budget);
  const { body, names } = markSheets(workbook, token, limits.maxArchiveEntries);
  const bytes = await repackage(
    archive,
    { name: WORKBOOK, body },
    budget - workbook.length,
  );
  return { bytes, names };
};

/**
 * One element per sheet that has text, after the cell-count pre-check, through
 * one anydoc call: anydoc writes no sheet boundary of its own, so each sheet
 * is renamed to a marker first. A file that fails the ZIP pre-check (legacy
 * XLS, encrypted OOXML) goes to anydoc whole as one unnumbered element.
 */
export const convertXlsx = async (
  bytes: Uint8Array,
  limits: ConversionLimits,
): Promise<readonly PageInfo[]> => {
  const archive = await inspectArchive(bytes, WORKBOOK, limits);
  if (archive == null) {
    const content = await convertOffice(bytes, 'xlsx');
    return [{ pageNumber: null, label: null, content }];
  }
  const token = newMarkerToken();
  let marked: MarkedPackage;
  try {
    await enforceCellLimit(archive, limits);
    marked = await markedPackage(archive, token, limits);
  } finally {
    archive.close();
  }
  const markdown = await convertOffice(marked.bytes, 'xlsx');
  return splitByMarkers(markdown, token, marked.names);
};
