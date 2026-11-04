// Test-only document generators. Never import from src/.
// The parts lists, editPart and buildZip are exported so a test can rewrite one
// part of a package, as the Python tests' `_rewrite` helpers do.
export {
  buildBrokenXmlDocx,
  buildDeeplyNestedDocx,
  buildDocxWithoutDocumentPart,
  buildTruncatedDocx,
  buildZipBombDocx,
  MAX_ARCHIVE_UNCOMPRESSED_MB,
  zipSignatureFollowedBy,
} from './crafted-docx';
export {
  buildCorruptPdf,
  buildGarbagePdf,
  buildJapaneseLinesPdf,
  buildLongPagePdf,
  buildOwnerPasswordOnlyPdf,
  buildUserPasswordPdf,
  PDF_OWNER_PASSWORD,
  PDF_USER_PASSWORD,
  pdfHeaderFollowedBy,
} from './crafted-pdf';
export {
  buildAbsoluteTargetDeck,
  buildArtefactDeck,
  buildContractDeck,
  buildDeckWithPictures,
  buildDeckWithText,
  buildEntityExpansionRelationshipsDeck,
  buildNotesDeck,
  buildUnknownEncodingDeck,
  buildUnsafeTargetDeck,
  type ExtraRelationship,
  NOTES_DECK_SLIDE_RELS,
  UNKNOWN_ENCODING_PARTS,
  withRelationship,
} from './crafted-pptx';
export {
  buildCellCountPackage,
  buildCorruptSheetStreamPackage,
  buildDotDotTargetSheetXlsx,
  buildDuplicatedEntryXlsx,
  buildDuplicateSheetPartsPackage,
  buildLargePivotCacheXlsx,
  buildStaleReferenceXlsx,
  buildStoredEntriesXlsx,
  buildUtf16SheetPackage,
  CELL_COUNT_SHEET,
  CELL_COUNT_WORKBOOK,
  cellsSheetXml,
  DOT_DOT_SHEET_MARKER,
  NON_STANDARD_SHEET_LOCATIONS,
} from './crafted-xlsx';
export {
  buildCorruptBzip2Zip,
  buildCorruptDeflateZip,
  buildCorruptLzmaZip,
  buildDuplicateNameZip,
  buildEncryptedFlagZip,
  buildLyingSizesZip,
  buildTraversalNamesZip,
  buildTruncatedZip,
  buildUnsupportedMethodZip,
  buildUtf8FlagWithNonUtf8NameZip,
  buildVersionNeeded10xZip,
  buildZip64BombPartZip,
  buildZip64Zip,
  buildZipWithoutCentralDirectory,
  CRAFTED_ZIP_PART,
} from './crafted-zip';
export {
  JAPANESE_SAMPLE,
  PDF_PAGE_TEXTS,
  PLAIN_DOCUMENTS,
  type PlainDocument,
  type PlainDocumentKey,
} from './documents';
export { buildDocx, docxParts } from './docx';
export {
  buildEncryptedDocx,
  buildEncryptedPptx,
  buildEncryptedXlsx,
  ENCRYPTED_MARKER,
  OFFICE_PASSWORD,
} from './encrypted-office';
export { buildEpub } from './epub';
export {
  buildLargeImagesDocx,
  buildLargeImagesPptx,
  buildTwelveImagesDocx,
  randomGrayPngs,
} from './large-images';
export {
  buildLargeForTimeoutXlsx,
  buildOneSheetAtCellLimitXlsx,
  buildOneSheetOverCellLimitXlsx,
  buildOverCellLimitXlsx,
  buildXlsxCells,
  type CellGrid,
  MAX_XLSX_CELLS,
} from './large-xlsx';
export { LEGACY_DOC_PATH, LEGACY_PPT_PATH } from './legacy';
export {
  editPart,
  type OoxmlPart,
  replaceOrThrow,
} from './ooxml-package';
export { buildOpenDocument } from './opendocument';
export { buildImageOnlyPdf, buildTextPdf } from './pdf';
export { buildGrayPng } from './png';
export {
  buildPptx,
  type PptxGroup,
  type PptxPicture,
  type PptxSlide,
  pptxParts,
} from './pptx';
export { buildRtf } from './rtf';
export { encodeText, type TextEncodingName } from './text-encoding';
export { buildXls } from './xls';
export {
  buildXlsx,
  type XlsxCell,
  type XlsxDefinedName,
  type XlsxFormulaCell,
  type XlsxSheet,
  xlsxParts,
} from './xlsx';
export { buildZip, type ZipEntry, type ZipInput } from './zip';
