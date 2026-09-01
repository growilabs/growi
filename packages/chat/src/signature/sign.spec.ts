import {
  createPrivateKey,
  createSecretKey,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
} from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeContentDigest } from './content-digest.js';
import { COVERED_COMPONENTS } from './covered-components.js';
import { encodeKeyId, type KeyRef } from './key-identity.js';
import { DEFAULT_EXPIRES_IN_SEC, SIGNATURE_LABEL, sign } from './sign.js';
import {
  buildSignatureBase,
  type SignatureParamValue,
} from './signature-base.js';
import { SIGNATURE_ALGORITHM, SIGNATURE_PARAMS } from './signature-params.js';

const NOW_MS = 1_700_000_000_000;
const NOW_SEC = NOW_MS / 1000;

const keyPair = generateKeyPairSync('ed25519');

const KEY: KeyRef = { relationId: 'rel-1', keyId: 'growi-key-1' };

const BODY = new TextEncoder().encode(
  JSON.stringify({ relationId: 'rel-1', op: 'capabilities' }),
);

const HEADERS = { 'content-type': 'application/json' } as const;

const signFixture = (
  overrides: Partial<Parameters<typeof sign>[0]> = {},
): ReturnType<typeof sign> =>
  sign({
    method: 'POST',
    headers: HEADERS,
    body: BODY,
    key: KEY,
    privateKey: keyPair.privateKey,
    expiresInSec: DEFAULT_EXPIRES_IN_SEC,
    nonce: 'nonce-fixture',
    ...overrides,
  });

describe('sign', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns exactly the three headers the peer has to send', () => {
    const result = signFixture();

    expect(Object.keys(result.headers).sort()).toStrictEqual([
      'content-digest',
      'signature',
      'signature-input',
    ]);
    expect(result.headers['content-digest']).toBe(computeContentDigest(BODY));
  });

  it('puts the signature parameters into `signature-input`, in the declared order', () => {
    const result = signFixture();

    expect(result.headers['signature-input']).toBe(
      `${SIGNATURE_LABEL}=("@method" "content-type" "content-digest");created=${NOW_SEC};expires=${
        NOW_SEC + DEFAULT_EXPIRES_IN_SEC
      };nonce="nonce-fixture";keyid="${encodeKeyId(KEY)}";alg="${SIGNATURE_ALGORITHM}"`,
    );
    // The header carries every declared parameter -- verification depends on
    // `expires` and `nonce` being present (requirements 10.3, 10.4).
    for (const name of SIGNATURE_PARAMS) {
      expect(result.headers['signature-input']).toContain(`${name}=`);
    }
  });

  it('signs the RFC 9421 signature base, verifiable with the matching public key', () => {
    const result = signFixture();

    const params = new Map<string, SignatureParamValue>([
      ['created', NOW_SEC],
      ['expires', NOW_SEC + DEFAULT_EXPIRES_IN_SEC],
      ['nonce', 'nonce-fixture'],
      ['keyid', encodeKeyId(KEY)],
      ['alg', SIGNATURE_ALGORITHM],
    ]);
    const base = buildSignatureBase(
      COVERED_COMPONENTS,
      {
        method: 'POST',
        headers: { ...HEADERS, 'content-digest': computeContentDigest(BODY) },
      },
      params,
    );

    const [, encoded] = /^sig1=:(.*):$/.exec(result.headers.signature) ?? [];
    expect(encoded).toBeDefined();
    expect(
      nodeVerify(
        null,
        Buffer.from(base, 'utf8'),
        keyPair.publicKey,
        Buffer.from(encoded as string, 'base64'),
      ),
    ).toBe(true);
  });

  it('reports the nonce it used and when the signature expires', () => {
    const result = signFixture({ expiresInSec: 120 });

    expect(result.nonce).toBe('nonce-fixture');
    expect(result.expiresAt).toStrictEqual(new Date(NOW_MS + 120_000));
  });

  it('generates a fresh nonce when the caller does not supply one', () => {
    vi.useRealTimers();

    const first = signFixture({ nonce: undefined });
    const second = signFixture({ nonce: undefined });

    expect(first.nonce).not.toBe(second.nonce);
    expect(first.nonce.length).toBeGreaterThanOrEqual(16);
    expect(first.headers['signature-input']).toContain(
      `nonce="${first.nonce}"`,
    );
  });

  it('never lets the private key out of the function (requirement 9.6, 10.6)', () => {
    const result = signFixture();

    const secret = keyPair.privateKey
      .export({ format: 'der', type: 'pkcs8' })
      .toString('base64');
    const seen = JSON.stringify(result);
    expect(seen).not.toContain(secret);
    // The whole result is plain data -- no KeyObject reachable from it.
    const values = [...Object.values(result), ...Object.values(result.headers)];
    for (const value of values) {
      expect(value).not.toBe(keyPair.privateKey);
      expect(String(value)).not.toContain('PRIVATE KEY');
    }
  });

  it('refuses a key that is not an Ed25519 private key', () => {
    expect(() => signFixture({ privateKey: keyPair.publicKey })).toThrow();

    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(() => signFixture({ privateKey: rsa.privateKey })).toThrow();

    const secret = createSecretKey(Buffer.alloc(32));
    expect(() => signFixture({ privateKey: secret })).toThrow();
  });

  it('refuses a validity period that is not a positive whole number of seconds', () => {
    expect(() => signFixture({ expiresInSec: 0 })).toThrow();
    expect(() => signFixture({ expiresInSec: -1 })).toThrow();
    expect(() => signFixture({ expiresInSec: 1.5 })).toThrow();
  });

  it('declares 60 seconds as the recommended validity period', () => {
    expect(DEFAULT_EXPIRES_IN_SEC).toBe(60);
  });

  it('accepts a private key restored from its exported form', () => {
    // The app/proxy sides keep key material at rest and rebuild the KeyObject.
    const restored = createPrivateKey(
      keyPair.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    );
    const fromRestored = signFixture({ privateKey: restored });

    expect(fromRestored.headers.signature).toBe(
      signFixture().headers.signature,
    );
    expect(nodeSign(null, Buffer.from('x', 'utf8'), restored).length).toBe(64);
  });
});
