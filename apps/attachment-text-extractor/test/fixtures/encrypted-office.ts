import CFB from 'cfb';
import officeCrypto from 'officecrypto-tool';

import { buildDocx } from './docx';
import { fixCfbFreeSectors } from './ole';
import { buildPptx } from './pptx';
import { createRandomBytes } from './seeded-random';
import { buildXlsx } from './xlsx';
import { buildZip, type ZipInput } from './zip';

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

const END_RECORD_SIGNATURE = 0x06054b50;
const END_RECORD_BYTES = 22;
const END_RECORD_DIRECTORY_SIZE = 12;
// The window CPython's zipfile searches for the end record: the record plus
// the longest comment.
const END_RECORD_SEARCH_WINDOW = 0xffff + END_RECORD_BYTES;
const NOISE_BYTES = 200_000;
const PROBE_BYTES = 32;

/**
 * An encrypted package whose ciphertext holds an end-of-central-directory
 * record further from the end of the file than the last 64 KiB. Its size
 * (100) points into the ciphertext and its offset (0) at the OLE signature,
 * so it leads to no central directory. Incompressible noise makes the
 * package large enough.
 */
export const buildEncryptedWithFarEndRecord = (
  parts: readonly ZipInput[],
): Buffer => {
  const noise: ZipInput = {
    name: 'noise.bin',
    data: createRandomBytes(11)(NOISE_BYTES),
    method: 'stored',
  };
  const encrypted = encryptOoxml(buildZip([...parts, noise]));
  const entry = CFB.find(
    CFB.read(encrypted, { type: 'buffer' }),
    '/EncryptedPackage',
  );
  if (entry == null) {
    throw new Error('no EncryptedPackage stream');
  }
  // A probe from early in the stream's ciphertext locates it in the file.
  const probe = Buffer.from(entry.content).subarray(1024, 1024 + PROBE_BYTES);
  const at = encrypted.indexOf(probe);
  if (at < 0 || encrypted.length - at <= END_RECORD_SEARCH_WINDOW) {
    throw new Error('the record would not lie beyond the last 64 KiB');
  }
  encrypted.fill(0, at, at + END_RECORD_BYTES);
  encrypted.writeUInt32LE(END_RECORD_SIGNATURE, at);
  encrypted.writeUInt32LE(100, at + END_RECORD_DIRECTORY_SIZE);
  return encrypted;
};
