import { randomBytes } from 'node:crypto';

import { ConversionError } from '../conversion-error';
import { childElements, firstChildElement } from './dom-elements';
import { parseXmlPart, serializeXmlPart } from './safe-xml';

// Hex only: anydoc prints headings verbatim, and no Markdown escaping touches
// alphanumerics. Random per call, so cell text cannot forge a marker.
const TOKEN_BYTES = 16;

export const newMarkerToken = (): string =>
  randomBytes(TOKEN_BYTES).toString('hex');

export const markerOf = (token: string, position: number): string =>
  `ZZ${token}${position}ZZ`;

export interface MarkedWorkbook {
  readonly body: Buffer;
  /** Stored sheet names in workbook order (null for a sheet without one). */
  readonly names: readonly (string | null)[];
}

/**
 * workbook.xml with every sheet renamed to its 1-based marker and shown.
 * Only <sheet name> changes: defined names and formulas keep the old names,
 * which anydoc does not read when rendering cells.
 */
export const markSheets = (
  workbook: Uint8Array,
  token: string,
  maxSheets: number,
): MarkedWorkbook => {
  const document = parseXmlPart(workbook, 'workbook.xml');
  const sheets = childElements(
    firstChildElement(document.documentElement, 'sheets'),
    'sheet',
  );
  if (sheets.length > maxSheets) {
    throw new ConversionError(
      'limit_exceeded',
      'sheet list is longer than the archive entry limit',
    );
  }
  const names = sheets.map((sheet) => sheet.getAttribute('name'));
  sheets.forEach((sheet, index) => {
    sheet.setAttribute('name', markerOf(token, index + 1));
    if (sheet.hasAttribute('state')) {
      sheet.setAttribute('state', 'visible');
    }
  });
  return { body: serializeXmlPart(document), names };
};
