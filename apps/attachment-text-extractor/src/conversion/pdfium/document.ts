import { ConversionError } from '../conversion-error';
import { allocate, type Pdfium, release } from './runtime';

// FPDF_ERR_PASSWORD / FPDF_ERR_SECURITY: only reported when the user password
// is needed. An owner-password-only PDF opens normally.
const FPDF_ERR_PASSWORD = 4;
const FPDF_ERR_SECURITY = 5;

const openFailure = (errorCode: number): ConversionError =>
  errorCode === FPDF_ERR_PASSWORD || errorCode === FPDF_ERR_SECURITY
    ? new ConversionError('encrypted', 'PDF requires a password to open')
    : new ConversionError('malformed', 'PDF could not be opened');

/** Opens the PDF inside WASM memory, hands its handle to `use`, and always closes it. */
export const withPdfDocument = <T>(
  pdfium: Pdfium,
  bytes: Uint8Array,
  use: (document: number) => T,
): T => {
  // At least one byte, so empty input still gets a real pointer and fails to open as malformed.
  const data = allocate(pdfium, Math.max(bytes.length, 1));
  try {
    // Read after malloc: growing the memory replaces HEAPU8.
    pdfium.pdfium.HEAPU8.set(bytes, data);
    // PDFium reads from `data` until the document is closed.
    const document = pdfium.FPDF_LoadMemDocument(data, bytes.length, '');
    if (document === 0) {
      throw openFailure(pdfium.FPDF_GetLastError());
    }
    try {
      return use(document);
    } finally {
      pdfium.FPDF_CloseDocument(document);
    }
  } finally {
    release(pdfium, data);
  }
};
