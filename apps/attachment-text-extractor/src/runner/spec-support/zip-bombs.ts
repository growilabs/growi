import {
  buildZip,
  pptxParts,
  xlsxParts,
  type ZipInput,
} from '../../../test/fixtures';
import { deflateChunks } from '../../../test/fixtures/deflate-chunks';

// PPTX / XLSX files under 1 MB with one part that inflates past
// MAX_ARCHIVE_UNCOMPRESSED_MB (512 MiB), for the real child (research.md 22.7,
// the 4.3 list). The part is well-formed XML padded with whitespace, so no other
// limit (cell count, malformed XML) is reached before the archive limit.

const MIB = 1024 * 1024;
const BOMB_BYTES = (512 + 8) * MIB;
const LYING_SIZE = 4096;

export type DeclaredSize =
  /** The headers state the real size: the declared-size check alone refuses it. */
  | 'honest'
  /** The headers claim 4 KiB: only a reader that stops early keeps memory flat. */
  | 'lying';

function* paddedXml(opening: string): Generator<Buffer> {
  yield Buffer.from(opening);
  // The same Buffer each time, so deflateChunks compresses it only once.
  const padding = Buffer.alloc(MIB, 0x20);
  for (let written = 0; written < BOMB_BYTES; written += MIB) {
    yield padding;
  }
}

const bombPart = (
  name: string,
  opening: string,
  declared: DeclaredSize,
): ZipInput => {
  const deflated = deflateChunks(paddedXml(opening));
  return {
    name,
    deflated:
      declared === 'honest'
        ? deflated
        : { ...deflated, uncompressedSize: LYING_SIZE },
  };
};

const withPart = (parts: readonly ZipInput[], replacement: ZipInput): Buffer =>
  buildZip(
    parts.map((part) => (part.name === replacement.name ? replacement : part)),
  );

export const buildPptxBomb = (declared: DeclaredSize): Buffer =>
  withPart(
    pptxParts([{ title: 'bomb' }]),
    bombPart(
      'ppt/slides/slide1.xml',
      '<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">',
      declared,
    ),
  );

export const buildXlsxBomb = (declared: DeclaredSize): Buffer =>
  withPart(
    xlsxParts([{ name: 'Sheet1', rows: [['bomb']] }]),
    bombPart(
      'xl/worksheets/sheet1.xml',
      '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
      declared,
    ),
  );
