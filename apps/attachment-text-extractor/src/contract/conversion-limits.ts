export interface ConversionLimits {
  readonly maxXlsxCells: number;
  readonly maxPdfPages: number;
  readonly maxArchiveEntries: number;
  readonly maxArchiveUncompressedBytes: number;
  readonly maxResultBytes: number;
  readonly maxCsvBytes: number;
  readonly maxHtmlBytes: number;
}
