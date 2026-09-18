// A real AES-256-GCM `SecretCipher` for this directory's tests. Not shipped:
// `tsconfig.build.json` excludes it alongside `*.spec.ts` / `*.integ.ts`.
//
// Why not the production one from `runtime/config.ts`: `runtime/` is outside
// the declared layer chain and nothing in the chain -- tests included, since
// `src/architecture.spec.ts` walks every `.ts` under `src/` -- may import it.
//
// Why that is not a gap in what the tests prove: a repository never learns
// what algorithm or storage format it is handed. It receives two functions and
// its whole contract is "call `encrypt` on the way in, `decrypt` on the way
// out", so there is no format for this fixture to drift away from. The
// production cipher's own behaviour (AES-256-GCM, fresh IV per call, a read
// that fails on a tampered value) is proved by `runtime/config.spec.ts`.
// Using real authenticated encryption here rather than a stub matters for a
// different reason: a stub could not tell "the repository encrypted the value"
// apart from "the repository forgot to".

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { SecretCipher } from '../../types/index.js';

const KEY = Buffer.alloc(32, 7);
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

export const testCipher: SecretCipher = {
  encrypt: (plaintext: string): string => {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv('aes-256-gcm', KEY, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
      'base64',
    );
  },

  decrypt: (ciphertext: string): string => {
    const raw = Buffer.from(ciphertext, 'base64');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      KEY,
      raw.subarray(0, IV_LENGTH_BYTES),
    );
    decipher.setAuthTag(
      raw.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES),
    );
    return Buffer.concat([
      decipher.update(raw.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  },
};
