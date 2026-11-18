import type { ConversionLimits } from '../../contract';
import { type ChildHeader, encodeChildHeader } from '../../wire/child-header';
import { encodeFrameHeader } from '../../wire/length-prefixed-json';

// The input frames the runner sends a child entry, for tests that start the
// real entry themselves.

const MIB = 1024 * 1024;

export const ENTRY_LIMITS: ConversionLimits = {
  maxXlsxCells: 70_000,
  maxPdfPages: 5_000,
  maxArchiveEntries: 10_000,
  maxArchiveUncompressedBytes: 512 * MIB,
  maxResultBytes: 16 * MIB,
  maxCsvBytes: 8 * MIB,
  maxHtmlBytes: 20 * MIB,
};

/** Appears in file names and bodies; must never reach stdout, stderr or a failure detail. */
export const INPUT_MARKER = 'input-marker-4b9e';

export const entryHeader = (
  overrides: Partial<ChildHeader> = {},
): ChildHeader => ({
  fileName: `${INPUT_MARKER}.txt`,
  mimeHint: 'text/plain',
  limits: ENTRY_LIMITS,
  maxInputBytes: MIB,
  ...overrides,
});

export const framed = (body: Uint8Array): Buffer =>
  Buffer.concat([encodeFrameHeader(body.length), body]);

/** Header frame then file frame, as one write. */
export const entryInput = (header: ChildHeader, file: Uint8Array): Buffer =>
  Buffer.concat([framed(encodeChildHeader(header)), framed(file)]);
