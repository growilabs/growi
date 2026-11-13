import type { ConversionLimits } from '../../contract';

const MIB = 1024 * 1024;

const PRODUCTION_DEFAULTS: ConversionLimits = {
  maxXlsxCells: 70_000,
  maxPdfPages: 5_000,
  maxArchiveEntries: 10_000,
  maxArchiveUncompressedBytes: 512 * MIB,
  maxResultBytes: 16 * MIB,
  maxCsvBytes: 8 * MIB,
  maxHtmlBytes: 20 * MIB,
};

/** Production defaults with the given limits replaced. */
export const conversionLimits = (
  overrides: Partial<ConversionLimits> = {},
): ConversionLimits => ({ ...PRODUCTION_DEFAULTS, ...overrides });
