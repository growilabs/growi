import {
  createHash,
  generateKeyPairSync,
  type KeyObject,
  sign as nodeSign,
} from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { computeContentDigest } from './content-digest.js';
import {
  COVERED_COMPONENTS,
  type CoveredComponent,
} from './covered-components.js';
import { encodeKeyId, type KeyRef } from './key-identity.js';
import { DEFAULT_EXPIRES_IN_SEC, SIGNATURE_LABEL, sign } from './sign.js';
import {
  buildSignatureBase,
  type SignatureParamValue,
} from './signature-base.js';
import {
  SIGNATURE_ALGORITHM,
  SIGNATURE_PARAMS,
  type SignatureParamName,
} from './signature-params.js';
import { serializeStringInnerList } from './structured-fields.js';
import {
  CLOCK_SKEW_TOLERANCE_SEC,
  MAX_ACCEPTED_EXPIRES_IN_SEC,
  type VerifyFailure,
  type VerifyParams,
  type VerifyResult,
  verify,
} from './verify.js';

const NOW_MS = 1_700_000_000_000;
const NOW_SEC = NOW_MS / 1000;

const peer = generateKeyPairSync('ed25519');
const own = generateKeyPairSync('ed25519');

const KEY: KeyRef = { relationId: 'rel-1', keyId: 'growi-key-1' };
const NONCE = 'nonce-fixture';

const BODY = new TextEncoder().encode(
  JSON.stringify({ relationId: 'rel-1', op: 'capabilities' }),
);
const OTHER_BODY = new TextEncoder().encode(
  JSON.stringify({ relationId: 'rel-1', op: 'settings-push' }),
);

const HEADERS = { 'content-type': 'application/json' } as const;

type SignedHeaders = {
  'content-digest': string;
  'signature-input': string;
  signature: string;
};

/**
 * A deliberately non-conforming peer: it signs whatever signature parameters
 * it is handed, including ones `sign` would never emit (a validity period
 * beyond the cap, a missing `expires`, a `created` in the future). The
 * receiver's own guards are exactly what this exists to exercise -- driving
 * these cases through `sign` would make the tests depend on `sign` staying
 * willing to emit them.
 */
const signAsForeignPeer = (options: {
  params: ReadonlyMap<string, SignatureParamValue>;
  body?: Uint8Array;
  method?: string;
  privateKey?: KeyObject;
}): SignedHeaders => {
  const body = options.body ?? BODY;
  const method = options.method ?? 'POST';
  const contentDigest = computeContentDigest(body);
  const base = buildSignatureBase(
    COVERED_COMPONENTS,
    { method, headers: { ...HEADERS, 'content-digest': contentDigest } },
    options.params,
  );
  const signature = nodeSign(
    null,
    Buffer.from(base, 'utf8'),
    options.privateKey ?? peer.privateKey,
  );
  return {
    'content-digest': contentDigest,
    'signature-input': `${SIGNATURE_LABEL}=${serializeStringInnerList(
      [...COVERED_COMPONENTS],
      options.params,
    )}`,
    signature: `${SIGNATURE_LABEL}=:${signature.toString('base64')}:`,
  };
};

const paramsOf = (
  overrides: Readonly<Record<string, SignatureParamValue | undefined>> = {},
): ReadonlyMap<string, SignatureParamValue> => {
  const base: Record<string, SignatureParamValue | undefined> = {
    created: NOW_SEC,
    expires: NOW_SEC + DEFAULT_EXPIRES_IN_SEC,
    nonce: NONCE,
    keyid: encodeKeyId(KEY),
    alg: SIGNATURE_ALGORITHM,
    ...overrides,
  };
  return new Map(
    Object.entries(base).filter(
      (entry): entry is [string, SignatureParamValue] => entry[1] !== undefined,
    ),
  );
};

/** Rebuilds only the `signature-input` header -- the signature stays as signed. */
const withSignatureInput = (
  headers: SignedHeaders,
  params: ReadonlyMap<string, SignatureParamValue>,
): SignedHeaders => ({
  ...headers,
  'signature-input': `${SIGNATURE_LABEL}=${serializeStringInnerList(
    [...COVERED_COMPONENTS],
    params,
  )}`,
});

const signFixture = (): SignedHeaders =>
  sign({
    method: 'POST',
    headers: HEADERS,
    body: BODY,
    key: KEY,
    privateKey: peer.privateKey,
    expiresInSec: DEFAULT_EXPIRES_IN_SEC,
    nonce: NONCE,
  }).headers;

const resolvePeerKey = vi.fn(async (ref: KeyRef) =>
  ref.relationId === KEY.relationId && ref.keyId === KEY.keyId
    ? peer.publicKey
    : null,
);

const consumeNonce = vi.fn(async () => true);

const verifyFixture = (
  overrides: Partial<VerifyParams> & { headers?: SignedHeaders } = {},
): Promise<Awaited<ReturnType<typeof verify>>> => {
  const { headers, ...rest } = overrides;
  return verify({
    method: 'POST',
    headers: { ...HEADERS, ...(headers ?? signFixture()) },
    body: BODY,
    resolvePublicKey: resolvePeerKey,
    consumeNonce,
    ...rest,
  });
};

describe('verify', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts a signature this package produced and reports whose key it was', async () => {
    await expect(verifyFixture()).resolves.toStrictEqual({
      ok: true,
      key: KEY,
    });
    expect(consumeNonce).toHaveBeenCalledWith(
      KEY,
      NONCE,
      new Date((NOW_SEC + DEFAULT_EXPIRES_IN_SEC) * 1000),
    );
  });

  it('reads the signature headers whatever case they are spelled in', async () => {
    const signed = signFixture();

    await expect(
      verify({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Digest': signed['content-digest'],
          'Signature-Input': signed['signature-input'],
          Signature: signed.signature,
        },
        body: BODY,
        resolvePublicKey: resolvePeerKey,
        consumeNonce,
      }),
    ).resolves.toStrictEqual({ ok: true, key: KEY });
  });

  describe('tampering with one covered field at a time always fails', () => {
    // Driven by the two declaration lists, so a field added to either is
    // covered by this matrix without anyone remembering to write a case
    // (the task's acceptance line: every covered component and every
    // signature parameter, one at a time).
    const componentTampering: Record<
      CoveredComponent,
      {
        readonly verifyTampered: () => Promise<VerifyResult>;
        readonly failure: VerifyFailure;
      }
    > = {
      '@method': {
        verifyTampered: () => verifyFixture({ method: 'PUT' }),
        failure: 'signature-mismatch',
      },
      'content-type': {
        verifyTampered: () =>
          verify({
            method: 'POST',
            headers: { ...signFixture(), 'content-type': 'text/plain' },
            body: BODY,
            resolvePublicKey: resolvePeerKey,
            consumeNonce,
          }),
        failure: 'signature-mismatch',
      },
      'content-digest': {
        verifyTampered: () =>
          verifyFixture({
            headers: {
              ...signFixture(),
              'content-digest': computeContentDigest(OTHER_BODY),
            },
          }),
        failure: 'signature-mismatch',
      },
    };

    it.each(COVERED_COMPONENTS)('rejects a changed `%s`', async (component) => {
      const { verifyTampered, failure } = componentTampering[component];

      await expect(verifyTampered()).resolves.toStrictEqual({
        ok: false,
        failure,
      });
    });

    const parameterTampering: Record<
      SignatureParamName,
      {
        readonly value: SignatureParamValue;
        readonly failure: VerifyFailure;
        readonly resolvePublicKey?: VerifyParams['resolvePublicKey'];
      }
    > = {
      created: { value: NOW_SEC - 1, failure: 'signature-mismatch' },
      expires: {
        value: NOW_SEC + DEFAULT_EXPIRES_IN_SEC + 1,
        failure: 'signature-mismatch',
      },
      nonce: { value: 'other', failure: 'signature-mismatch' },
      keyid: {
        value: encodeKeyId({ relationId: 'rel-2', keyId: 'another-key' }),
        // Even a store that hands back a key for the changed reference does
        // not make the signature check out.
        resolvePublicKey: vi.fn(() => Promise.resolve(peer.publicKey)),
        failure: 'signature-mismatch',
      },
      // `alg` is covered like the rest -- `sign` puts it in
      // `@signature-params` -- but the guard that compares it against the
      // stored key's scheme runs before anything cryptographic, so this is
      // where a changed value is caught.
      alg: { value: 'rsa-pss-sha512', failure: 'malformed' },
    };

    it.each(SIGNATURE_PARAMS)('rejects a changed `%s`', async (name) => {
      const { value, failure, resolvePublicKey } = parameterTampering[name];

      await expect(
        verifyFixture({
          headers: withSignatureInput(
            signFixture(),
            paramsOf({ [name]: value }),
          ),
          ...(resolvePublicKey == null ? {} : { resolvePublicKey }),
        }),
      ).resolves.toStrictEqual({ ok: false, failure });
    });

    it('rejects a body that does not hash to the covered digest', async () => {
      // Every header stays exactly as signed -- only the bytes change. The
      // signature covers the digest header's *value*, so nothing but the
      // receiver recomputing the digest catches this (requirement 10.1).
      await expect(verifyFixture({ body: OTHER_BODY })).resolves.toStrictEqual({
        ok: false,
        failure: 'digest-mismatch',
      });
    });
  });

  describe('the validity window', () => {
    it('rejects a signature whose validity period has passed', async () => {
      const signed = signFixture();
      vi.setSystemTime(NOW_MS + (DEFAULT_EXPIRES_IN_SEC + 1) * 1000);

      await expect(verifyFixture({ headers: signed })).resolves.toStrictEqual({
        ok: false,
        failure: 'expired',
      });
    });

    it('caps the accepted validity period, however long the sender declared', async () => {
      const headers = signAsForeignPeer({
        params: paramsOf({ expires: NOW_SEC + 3600 }),
      });
      vi.setSystemTime(NOW_MS + (MAX_ACCEPTED_EXPIRES_IN_SEC + 1) * 1000);

      await expect(verifyFixture({ headers })).resolves.toStrictEqual({
        ok: false,
        failure: 'expired',
      });
      expect(consumeNonce).not.toHaveBeenCalled();
    });

    it('hands the capped expiry to the nonce store, not the one that was sent', async () => {
      const headers = signAsForeignPeer({
        params: paramsOf({ expires: NOW_SEC + 3600 }),
      });

      await expect(verifyFixture({ headers })).resolves.toStrictEqual({
        ok: true,
        key: KEY,
      });
      expect(consumeNonce).toHaveBeenCalledWith(
        KEY,
        NONCE,
        new Date((NOW_SEC + MAX_ACCEPTED_EXPIRES_IN_SEC) * 1000),
      );
    });

    it('tolerates a small clock difference on `created`', async () => {
      const headers = signAsForeignPeer({
        params: paramsOf({
          created: NOW_SEC + CLOCK_SKEW_TOLERANCE_SEC,
          expires: NOW_SEC + CLOCK_SKEW_TOLERANCE_SEC + DEFAULT_EXPIRES_IN_SEC,
        }),
      });

      await expect(verifyFixture({ headers })).resolves.toStrictEqual({
        ok: true,
        key: KEY,
      });
    });

    it('rejects a `created` further in the future than the tolerated difference', async () => {
      const created = NOW_SEC + CLOCK_SKEW_TOLERANCE_SEC + 1;
      const headers = signAsForeignPeer({
        params: paramsOf({
          created,
          expires: created + DEFAULT_EXPIRES_IN_SEC,
        }),
      });

      await expect(verifyFixture({ headers })).resolves.toStrictEqual({
        ok: false,
        failure: 'expired',
      });
      expect(consumeNonce).not.toHaveBeenCalled();
    });
  });

  describe('signatures that leave out what the guards depend on', () => {
    it('rejects a signature with no `expires` (requirement 10.3)', async () => {
      const params = paramsOf({ expires: undefined });
      const headers = signAsForeignPeer({ params });

      await expect(verifyFixture({ headers })).resolves.toStrictEqual({
        ok: false,
        failure: 'malformed',
      });
    });

    it('rejects a signature with no `nonce` (requirement 10.4)', async () => {
      const headers = signAsForeignPeer({
        params: paramsOf({ nonce: undefined }),
      });

      await expect(verifyFixture({ headers })).resolves.toStrictEqual({
        ok: false,
        failure: 'malformed',
      });
    });

    it('rejects a `created` that is not a whole number of seconds', async () => {
      // RFC 8941 Decimals parse as numbers too; RFC 9421 section 6.5.2 says
      // these are Unix timestamps.
      const headers = signAsForeignPeer({ params: paramsOf({ created: 1.5 }) });

      await expect(verifyFixture({ headers })).resolves.toStrictEqual({
        ok: false,
        failure: 'malformed',
      });
    });

    it('rejects a `keyid` that does not name a relation and a key', async () => {
      const headers = signAsForeignPeer({
        params: paramsOf({ keyid: 'no-relation-part' }),
      });

      await expect(verifyFixture({ headers })).resolves.toStrictEqual({
        ok: false,
        failure: 'malformed',
      });
    });

    it('rejects a signature with no `keyid`', async () => {
      const headers = signAsForeignPeer({
        params: paramsOf({ keyid: undefined }),
      });

      await expect(verifyFixture({ headers })).resolves.toStrictEqual({
        ok: false,
        failure: 'malformed',
      });
    });

    it('passes a parameter it does not know about through to the signature base', async () => {
      // RFC 9421 allows further parameters; rebuilding the base from a fixed
      // list of five would reject a legitimate peer that sends more.
      const params = new Map<string, SignatureParamValue>([
        ...paramsOf(),
        ['tag', 'growi-chat'],
      ]);
      const headers = signAsForeignPeer({ params });

      await expect(verifyFixture({ headers })).resolves.toStrictEqual({
        ok: true,
        key: KEY,
      });
    });

    it('rejects a correctly signed request whose digest uses another algorithm', async () => {
      // A peer that hashed the body with something other than the algorithm
      // this package declares: the signature checks out, but there is nothing
      // to compare the body against.
      const contentDigest = `sha-256=:${createHash('sha256')
        .update(BODY)
        .digest('base64')}:`;
      const params = paramsOf();
      const base = buildSignatureBase(
        COVERED_COMPONENTS,
        {
          method: 'POST',
          headers: { ...HEADERS, 'content-digest': contentDigest },
        },
        params,
      );
      const signature = nodeSign(
        null,
        Buffer.from(base, 'utf8'),
        peer.privateKey,
      );

      await expect(
        verifyFixture({
          headers: {
            'content-digest': contentDigest,
            'signature-input': `${SIGNATURE_LABEL}=${serializeStringInnerList(
              [...COVERED_COMPONENTS],
              params,
            )}`,
            signature: `${SIGNATURE_LABEL}=:${signature.toString('base64')}:`,
          },
        }),
      ).resolves.toStrictEqual({ ok: false, failure: 'malformed' });
      expect(consumeNonce).not.toHaveBeenCalled();
    });

    it('rejects a signature that covers a different set of components', async () => {
      const contentDigest = computeContentDigest(BODY);
      const covered = ['@method', 'content-digest'];
      const params = paramsOf();
      const base = buildSignatureBase(
        covered,
        {
          method: 'POST',
          headers: { ...HEADERS, 'content-digest': contentDigest },
        },
        params,
      );
      const signature = nodeSign(
        null,
        Buffer.from(base, 'utf8'),
        peer.privateKey,
      );

      await expect(
        verifyFixture({
          headers: {
            'content-digest': contentDigest,
            'signature-input': `${SIGNATURE_LABEL}=${serializeStringInnerList(covered, params)}`,
            signature: `${SIGNATURE_LABEL}=:${signature.toString('base64')}:`,
          },
        }),
      ).resolves.toStrictEqual({ ok: false, failure: 'malformed' });
    });
  });

  describe('the key the signature is checked against', () => {
    it('rejects a signature whose key cannot be resolved (revoked, not yet active, unknown)', async () => {
      const resolvesNothing = vi.fn(async () => null);

      await expect(
        verifyFixture({ resolvePublicKey: resolvesNothing }),
      ).resolves.toStrictEqual({ ok: false, failure: 'unknown-key' });
      expect(consumeNonce).not.toHaveBeenCalled();
    });

    it('rejects a resolved key that is not a usable Ed25519 public key', async () => {
      // A `resolvePublicKey` handing back the caller's *own* private key is
      // the wiring mistake the peer-only rule exists for.
      await expect(
        verifyFixture({ resolvePublicKey: vi.fn(async () => own.privateKey) }),
      ).resolves.toStrictEqual({ ok: false, failure: 'unknown-key' });

      const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
      await expect(
        verifyFixture({ resolvePublicKey: vi.fn(async () => rsa.publicKey) }),
      ).resolves.toStrictEqual({ ok: false, failure: 'unknown-key' });
    });

    it('rejects a signature made with another relation’s key', async () => {
      const headers = signAsForeignPeer({
        params: paramsOf(),
        privateKey: own.privateKey,
      });

      await expect(verifyFixture({ headers })).resolves.toStrictEqual({
        ok: false,
        failure: 'signature-mismatch',
      });
    });

    it('fails closed when the key store cannot answer', async () => {
      await expect(
        verifyFixture({
          resolvePublicKey: vi.fn(() =>
            Promise.reject(new Error('key store unreachable')),
          ),
        }),
      ).resolves.toStrictEqual({ ok: false, failure: 'unknown-key' });
      expect(consumeNonce).not.toHaveBeenCalled();
    });
  });

  describe('the one-time value', () => {
    it('rejects the second arrival of the same signed request', async () => {
      const used = new Set<string>();
      const store = vi.fn((ref: KeyRef, nonce: string) => {
        const token = `${encodeKeyId(ref)}/${nonce}`;
        if (used.has(token)) {
          return Promise.resolve(false);
        }
        used.add(token);
        return Promise.resolve(true);
      });
      const headers = signFixture();

      await expect(
        verifyFixture({ headers, consumeNonce: store }),
      ).resolves.toStrictEqual({ ok: true, key: KEY });
      await expect(
        verifyFixture({ headers, consumeNonce: store }),
      ).resolves.toStrictEqual({ ok: false, failure: 'replayed' });
    });

    it('accepts a retry that was signed again over the same body', async () => {
      // The retry keeps the request body (and therefore its `requestId`) and
      // takes a fresh nonce, so it is not the replay the guard above catches.
      const used = new Set<string>();
      const store = vi.fn((_ref: KeyRef, nonce: string) => {
        if (used.has(nonce)) {
          return Promise.resolve(false);
        }
        used.add(nonce);
        return Promise.resolve(true);
      });
      const first = sign({
        method: 'POST',
        headers: HEADERS,
        body: BODY,
        key: KEY,
        privateKey: peer.privateKey,
        expiresInSec: DEFAULT_EXPIRES_IN_SEC,
      }).headers;
      vi.setSystemTime(NOW_MS + 5000);
      const retry = sign({
        method: 'POST',
        headers: HEADERS,
        body: BODY,
        key: KEY,
        privateKey: peer.privateKey,
        expiresInSec: DEFAULT_EXPIRES_IN_SEC,
      }).headers;

      expect(retry['signature-input']).not.toBe(first['signature-input']);
      await expect(
        verifyFixture({ headers: first, consumeNonce: store }),
      ).resolves.toStrictEqual({ ok: true, key: KEY });
      await expect(
        verifyFixture({ headers: retry, consumeNonce: store }),
      ).resolves.toStrictEqual({ ok: true, key: KEY });
    });

    it('does not touch the nonce store when the signature does not check out', async () => {
      const signed = signFixture();

      await expect(
        verifyFixture({
          headers: withSignatureInput(signed, paramsOf({ nonce: 'other' })),
        }),
      ).resolves.toStrictEqual({ ok: false, failure: 'signature-mismatch' });
      expect(consumeNonce).not.toHaveBeenCalled();
    });

    it('does not touch the nonce store when the body does not match the digest', async () => {
      await expect(verifyFixture({ body: OTHER_BODY })).resolves.toStrictEqual({
        ok: false,
        failure: 'digest-mismatch',
      });
      expect(consumeNonce).not.toHaveBeenCalled();
    });

    it('fails closed when the nonce store cannot answer', async () => {
      await expect(
        verifyFixture({
          consumeNonce: vi.fn(() =>
            Promise.reject(new Error('nonce store unreachable')),
          ),
        }),
      ).resolves.toStrictEqual({ ok: false, failure: 'replayed' });
    });
  });

  describe('never throws', () => {
    const signed = () => signFixture();

    const malformedHeaderSets = (): Array<Record<string, string>> => {
      const ok = signed();
      return [
        {},
        { 'content-type': 'application/json' },
        { ...ok, 'signature-input': '' },
        { ...ok, 'signature-input': 'not a structured field ((' },
        { ...ok, 'signature-input': 'sig1=42' },
        { ...ok, 'signature-input': 'sig1=(1 2);created=1;expires=2' },
        { ...ok, 'signature-input': `sig1=(); created=1` },
        {
          ...ok,
          'signature-input': `${ok['signature-input']}, sig2=("@method")`,
        },
        { ...ok, signature: '' },
        { ...ok, signature: 'sig1="not-bytes"' },
        { ...ok, signature: 'sig1=:not-base64!!:' },
        { ...ok, signature: 'sig2=:AAAA:' },
        {
          ...ok,
          signature: `sig1=:${Buffer.from('short').toString('base64')}:`,
        },
        { ...ok, 'content-digest': 'sha-256=:AAAA:' },
        { ...ok, 'content-digest': 'garbage' },
        { ...ok, 'content-digest': '' },
        {
          ...ok,
          'signature-input': ok['signature-input'].replace(
            'created=',
            'created="',
          ),
        },
        {
          ...ok,
          'signature-input': ok['signature-input'].replace(
            /nonce="[^"]*"/,
            'nonce=1',
          ),
        },
        { 'signature-input': ok['signature-input'], signature: ok.signature },
      ];
    };

    it('answers with a failure for every malformed request it is handed', async () => {
      const results = await Promise.all(
        malformedHeaderSets().map((headers) =>
          verify({
            method: 'POST',
            headers,
            body: BODY,
            resolvePublicKey: resolvePeerKey,
            consumeNonce,
          }),
        ),
      );

      expect(results).toHaveLength(malformedHeaderSets().length);
      for (const result of results) {
        expect(result.ok).toBe(false);
      }
    });

    it('answers with a failure when handed something that is not bytes at all', async () => {
      // The app/proxy sides are JavaScript at run time, so a caller can hand
      // over whatever it read off the wire -- including `undefined`.
      await expect(
        verifyFixture({ body: undefined as unknown as Uint8Array }),
      ).resolves.toStrictEqual({ ok: false, failure: 'malformed' });
    });

    it('answers with a failure for an empty body and an oversized one', async () => {
      const results = await Promise.all(
        [new Uint8Array(0), new Uint8Array(100_000).fill(7)].map((body) =>
          verify({
            method: 'POST',
            headers: { ...HEADERS, ...signed() },
            body,
            resolvePublicKey: resolvePeerKey,
            consumeNonce,
          }),
        ),
      );

      for (const result of results) {
        expect(result.ok).toBe(false);
      }
    });
  });
});
