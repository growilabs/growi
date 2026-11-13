import officeCrypto from 'officecrypto-tool';

import { buildDocx } from './docx';
import { fixCfbFreeSectors } from './ole';
import { buildPptx } from './pptx';
import { buildXlsx } from './xlsx';

// ECMA-376 agile encryption by officecrypto-tool, the user's choice for
// encrypted Office files (research.md 9.10).

export const OFFICE_PASSWORD = 'office-test-password';
export const ENCRYPTED_MARKER = 'encrypted marker';

/**
 * officecrypto-tool writes its OLE container with cfb, whose unused FAT
 * entries anydoc rejects as malformed until they are fixed (research.md 9.7).
 */
export const encryptOoxml = (plain: Uint8Array): Buffer =>
  fixCfbFreeSectors(
    officeCrypto.encrypt(Buffer.from(plain), { password: OFFICE_PASSWORD }),
  );

export const buildEncryptedDocx = (): Buffer =>
  encryptOoxml(buildDocx([ENCRYPTED_MARKER]));

/** openpyxl's default sheet, `Sheet`, with the marker in A1. */
export const buildEncryptedXlsx = (): Buffer =>
  encryptOoxml(buildXlsx([{ name: 'Sheet', rows: [[ENCRYPTED_MARKER]] }]));

export const buildEncryptedPptx = (): Buffer =>
  encryptOoxml(buildPptx([{ title: ENCRYPTED_MARKER }]));
