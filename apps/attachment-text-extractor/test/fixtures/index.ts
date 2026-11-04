// Test-only document generators. Never import from src/.
export {
  JAPANESE_SAMPLE,
  PLAIN_DOCUMENTS,
  type PlainDocument,
  type PlainDocumentKey,
} from './documents';
export { buildDocx } from './docx';
export { buildEpub } from './epub';
export { LEGACY_DOC_PATH, LEGACY_PPT_PATH } from './legacy';
export { buildOpenDocument } from './opendocument';
export { buildImageOnlyPdf, buildTextPdf } from './pdf';
export { buildPptx } from './pptx';
export { buildRtf } from './rtf';
export { encodeText, type TextEncodingName } from './text-encoding';
export { buildXls } from './xls';
export { buildXlsx } from './xlsx';
