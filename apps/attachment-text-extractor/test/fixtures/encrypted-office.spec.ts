import CFB from 'cfb';
import officeCrypto from 'officecrypto-tool';

import {
  buildEncryptedDocx,
  buildEncryptedPptx,
  buildEncryptedXlsx,
  ENCRYPTED_MARKER,
  OFFICE_PASSWORD,
} from './encrypted-office';
import { anydocErrorCode, anydocMarkdown } from './spec-support';

const OLE_MAGIC = Buffer.from('d0cf11e0a1b11ae1', 'hex');

const streamContent = (ole: Buffer, name: string): Buffer => {
  const entry = CFB.find(CFB.read(ole, { type: 'buffer' }), `/${name}`);
  if (entry == null) {
    throw new Error(`no OLE stream named ${name}`);
  }
  return Buffer.from(entry.content);
};

describe.each([
  ['docx', buildEncryptedDocx],
  ['xlsx', buildEncryptedXlsx],
  ['pptx', buildEncryptedPptx],
] as const)('encrypted %s', (extension, build) => {
  // Encrypting derives keys with many hash rounds, so each format is built once.
  let encrypted: Buffer;
  beforeAll(() => {
    encrypted = build();
  });

  it('is an OLE file with ECMA-376 agile encryption (EncryptionInfo version 4.4)', () => {
    const info = streamContent(encrypted, 'EncryptionInfo');

    expect(encrypted.subarray(0, 8)).toEqual(OLE_MAGIC);
    expect([info.readUInt16LE(0), info.readUInt16LE(2)]).toEqual([4, 4]);
    expect(streamContent(encrypted, 'EncryptedPackage').length).toBeGreaterThan(
      0,
    );
  });

  it('is refused by anydoc as encrypted, not as malformed', async () => {
    expect(await anydocErrorCode(encrypted, extension)).toBe('encrypted');
  });

  it('decrypts with the office password to a document holding the marker', async () => {
    const plain = await officeCrypto.decrypt(encrypted, {
      password: OFFICE_PASSWORD,
    });

    expect(await anydocMarkdown(plain, extension)).toContain(ENCRYPTED_MARKER);
  });
});
