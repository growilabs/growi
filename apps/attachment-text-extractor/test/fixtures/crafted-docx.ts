import { deflateChunks } from './deflate-chunks';
import { buildDocx, docxParts } from './docx';
import { XML_DECLARATION } from './ooxml-package';
import { buildZip, type ZipInput } from './zip';

// DOCX files crafted in the Python service's tests/fixture_files.py and
// conversion/test_office.py.

const MIB = 1024 * 1024;
/** The Python service's MAX_ARCHIVE_UNCOMPRESSED_MB default. */
export const MAX_ARCHIVE_UNCOMPRESSED_MB = 512;
const DOCUMENT_PART = 'word/document.xml';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DOCUMENT_OPEN = `${XML_DECLARATION}<w:document xmlns:w="${W_NS}"><w:body>`;
const DOCUMENT_CLOSE = '</w:body></w:document>';

const withDocumentPart = (paragraph: string, document: ZipInput): Buffer =>
  buildZip(
    docxParts([paragraph]).map((part) =>
      part.name === document.name ? document : part,
    ),
  );

// About 1 MiB of 4000-character paragraphs per chunk, so memory stays flat.
function* bombDocumentChunks(targetBytes: number): Generator<Buffer> {
  yield Buffer.from(DOCUMENT_OPEN);
  const block = Buffer.from(
    `<w:p><w:r><w:t>${'A'.repeat(4000)}</w:t></w:r></w:p>`.repeat(256),
  );
  for (let written = 0; written < targetBytes; written += block.length) {
    yield block;
  }
  yield Buffer.from(DOCUMENT_CLOSE);
}

/**
 * A valid DOCX of under 1 MB whose document part expands past the archive
 * limit; written as zip64, as Python's `force_zip64` rewrite does.
 */
export const buildZipBombDocx = (): Buffer =>
  withDocumentPart('bomb', {
    name: DOCUMENT_PART,
    deflated: deflateChunks(
      bombDocumentChunks((MAX_ARCHIVE_UNCOMPRESSED_MB + 8) * MIB),
    ),
    zip64: true,
  });

/** A valid DOCX whose body nests `depth` levels of `w:sdt`. */
export const buildDeeplyNestedDocx = (depth = 100_000): Buffer =>
  withDocumentPart('nested', {
    name: DOCUMENT_PART,
    data:
      DOCUMENT_OPEN +
      '<w:sdt><w:sdtContent>'.repeat(depth) +
      '<w:p><w:r><w:t>deep</w:t></w:r></w:p>' +
      '</w:sdtContent></w:sdt>'.repeat(depth) +
      DOCUMENT_CLOSE,
  });

/** The first half of a real DOCX. */
export const buildTruncatedDocx = (): Buffer => {
  const whole = buildDocx(['truncated']);
  return whole.subarray(0, Math.floor(whole.length / 2));
};

export const buildBrokenXmlDocx = (): Buffer =>
  withDocumentPart('base', { name: DOCUMENT_PART, data: '<w:document <<<' });

export const buildDocxWithoutDocumentPart = (): Buffer =>
  buildZip(docxParts(['base']).filter((part) => part.name !== DOCUMENT_PART));

/** A ZIP local header signature and then plain text: no ZIP at all. */
export const zipSignatureFollowedBy = (text: string): Buffer =>
  Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(text)]);
