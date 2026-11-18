import { createHash } from 'node:crypto';

// The PDF Standard security handler, revision 3 with a 128-bit RC4 key
// (ISO 32000-1 7.6.3), the method pypdf's "RC4-128" writes.

/** Node 24's OpenSSL 3 refuses 'rc4' without the legacy provider. */
export const rc4 = (key: Uint8Array, data: Uint8Array): Buffer => {
  const state = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + state[i] + key[i % key.length]) & 255;
    [state[i], state[j]] = [state[j], state[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + state[i]) & 255;
    [state[i], state[j]] = [state[j], state[i]];
    out[k] = data[k] ^ state[(state[i] + state[j]) & 255];
  }
  return out;
};

const PASSWORD_PADDING = Buffer.from(
  '28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a',
  'hex',
);
// Every permission bit allowed, as pypdf writes it by default.
const ALL_PERMISSIONS = -3904;
const KEY_ITERATIONS = 50;
const RC4_ROUNDS = 20;

const md5 = (...parts: readonly Uint8Array[]): Buffer =>
  createHash('md5').update(Buffer.concat(parts)).digest();

const iteratedMd5 = (seed: Buffer): Buffer =>
  Array.from({ length: KEY_ITERATIONS }).reduce<Buffer>(
    (digest) => md5(digest),
    seed,
  );

const paddedPassword = (password: string): Buffer =>
  Buffer.concat([Buffer.from(password, 'latin1'), PASSWORD_PADDING]).subarray(
    0,
    32,
  );

// Algorithms 3 and 5: RC4 with the key, then 19 more passes with the key
// XORed with the pass number.
const rc4Rounds = (key: Buffer, data: Buffer): Buffer =>
  Array.from({ length: RC4_ROUNDS - 1 }, (_, i) => i + 1).reduce(
    (current, round) =>
      rc4(
        key.map((byte) => byte ^ round),
        current,
      ),
    rc4(key, data),
  );

export interface PdfEncryption {
  readonly userPassword: string;
  readonly ownerPassword: string;
  /** The first element of the trailer's `/ID`, 16 bytes. */
  readonly fileId: Buffer;
}

export interface StandardSecurityHandler {
  /** The `/Encrypt` dictionary. */
  readonly dictionary: string;
  /** Encrypts a stream's data with the key of the object that holds it. */
  readonly encryptStream: (objectNumber: number, data: Uint8Array) => Buffer;
}

export const standardSecurityHandler = ({
  userPassword,
  ownerPassword,
  fileId,
}: PdfEncryption): StandardSecurityHandler => {
  const ownerKey = iteratedMd5(
    md5(paddedPassword(ownerPassword || userPassword)),
  );
  const ownerEntry = rc4Rounds(ownerKey, paddedPassword(userPassword));
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(ALL_PERMISSIONS);
  const fileKey = iteratedMd5(
    md5(paddedPassword(userPassword), ownerEntry, permissions, fileId),
  );
  const userEntry = Buffer.concat([
    rc4Rounds(fileKey, md5(PASSWORD_PADDING, fileId)),
    Buffer.alloc(16),
  ]);
  const objectKey = (objectNumber: number): Buffer =>
    md5(
      fileKey,
      Buffer.from([
        objectNumber & 255,
        (objectNumber >> 8) & 255,
        (objectNumber >> 16) & 255,
        0,
        0,
      ]),
    ).subarray(0, 16);
  return {
    dictionary: `<< /Filter /Standard /V 2 /R 3 /Length 128 /P ${ALL_PERMISSIONS} /O <${ownerEntry.toString('hex')}> /U <${userEntry.toString('hex')}> >>`,
    encryptStream: (objectNumber, data) => rc4(objectKey(objectNumber), data),
  };
};
