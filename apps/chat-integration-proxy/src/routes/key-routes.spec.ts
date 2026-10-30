// The two endpoints a GROWI uses to manage the keys this proxy verifies its
// signatures with (design.md's 「GROWI から届く口」 rows `key-register-to-proxy`
// and `key-revoke-to-proxy`; Requirement 10.5).
//
// Same construction as `notification-routes.spec.ts`: a real Hono app, a real
// Ed25519 signature and the real `createInboundFlow`, with only the PostgreSQL
// client doubled. What this file is for is the WIRING -- that each path is
// guarded, that each body reaches its own parse function, and that
// `InboundFlow`'s answer travels back unchanged.
//
// **The uniqueness of a registration and the idempotency of a revocation are
// NOT re-proven here.** They are properties of `InboundFlow` (task 7.3) and
// are tested where they live (`orchestration/inbound-flow.spec.ts`); what is
// asserted below is only that the HTTP edge does not break them -- a second
// identical request over HTTP still answers `ok` and still writes by the
// `(relation_id, key_id)` unique key.

import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { OP_NAMES } from '@growi/chat';
import type { KeyRef, VerifyFailure } from '@growi/chat/server';
import { sign } from '@growi/chat/server';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { type DeepMockProxy, mock, mockDeep } from 'vitest-mock-extended';

import type { PrismaClient } from '../db/index.js';
import {
  createInboundFlow,
  type InboundFlowPlatform,
} from '../orchestration/index.js';
import type { SecretCipher } from '../types/index.js';
import { type KeyRoutesDeps, registerKeyRoutes } from './key-routes.js';
import type { SignedRequestEnv } from './signature-guard.js';

const REGISTER_PATH = '/chat-integration/keys/register';
const REVOKE_PATH = '/chat-integration/keys/revoke';
const CONTENT_TYPE = 'application/json';

const RELATION_ID = 'relation-1';
const KEY: KeyRef = { relationId: RELATION_ID, keyId: 'growi-key-0001' };

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

const fakeCipher: SecretCipher = {
  encrypt: (plaintext) => plaintext,
  decrypt: (ciphertext) => ciphertext,
};

/** A public key in the shape `PublicKeyRegistration` carries it. */
const publicKeyJwk = publicKey.export({ format: 'jwk' });

interface PeerKeyRow {
  relationId: string;
  keyId: string;
  publicKeyJwk: unknown;
  validFrom: Date;
  revokedAt: Date | null;
}

const peerKeyRow = (
  keyId: string,
  revokedAt: Date | null = null,
): PeerKeyRow => ({
  relationId: RELATION_ID,
  keyId,
  publicKeyJwk,
  validFrom: new Date('2026-01-01T00:00:00.000Z'),
  revokedAt,
});

/**
 * The storage double, holding `peer_key` rows in memory so the unique key and
 * the revocation flag actually behave -- a canned answer would let a second
 * registration look idempotent whatever the code did.
 */
const createPrisma = (
  initialRows: ReadonlyArray<PeerKeyRow>,
): { prisma: DeepMockProxy<PrismaClient>; rows: () => PeerKeyRow[] } => {
  const prisma = mockDeep<PrismaClient>();
  let rows: PeerKeyRow[] = [...initialRows];

  prisma.peerKey.findMany.mockImplementation(((args: {
    where: { relationId: string };
  }) =>
    Promise.resolve(
      rows.filter((row) => row.relationId === args.where.relationId),
    )) as never);

  prisma.peerKey.upsert.mockImplementation(((args: {
    where: { relationId_keyId: { relationId: string; keyId: string } };
    create: Omit<PeerKeyRow, 'revokedAt'>;
    update: Partial<PeerKeyRow>;
  }) => {
    const { relationId, keyId } = args.where.relationId_keyId;
    const existing = rows.find(
      (row) => row.relationId === relationId && row.keyId === keyId,
    );
    if (existing == null) {
      const created = { revokedAt: null, ...args.create };
      rows = [...rows, created];
      return Promise.resolve(created);
    }
    const updated = { ...existing, ...args.update };
    rows = rows.map((row) => (row === existing ? updated : row));
    return Promise.resolve(updated);
  }) as never);

  prisma.peerKey.update.mockImplementation(((args: {
    where: { relationId_keyId: { relationId: string; keyId: string } };
    data: Partial<PeerKeyRow>;
  }) => {
    const { relationId, keyId } = args.where.relationId_keyId;
    const existing = rows.find(
      (row) => row.relationId === relationId && row.keyId === keyId,
    );
    if (existing == null) {
      return Promise.reject(new Error('no such peer_key row'));
    }
    const updated = { ...existing, ...args.data };
    rows = rows.map((row) => (row === existing ? updated : row));
    return Promise.resolve(updated);
  }) as never);

  return { prisma, rows: () => rows };
};

const signedRequest = (options: {
  readonly path: string;
  readonly bodyText: string;
  readonly nonce?: string;
}): Request => {
  const bytes = new TextEncoder().encode(options.bodyText);
  const signed = sign({
    method: 'POST',
    headers: { 'content-type': CONTENT_TYPE },
    body: bytes,
    key: KEY,
    privateKey,
    expiresInSec: 60,
    nonce: options.nonce,
  });
  return new Request(`http://proxy.example${options.path}`, {
    method: 'POST',
    headers: { 'content-type': CONTENT_TYPE, ...signed.headers },
    body: bytes,
  });
};

const unsignedRequest = (path: string, bodyText: string): Request =>
  new Request(`http://proxy.example${path}`, {
    method: 'POST',
    headers: { 'content-type': CONTENT_TYPE },
    body: bodyText,
  });

const registrationBody = (keyId: string): string =>
  JSON.stringify({
    relationId: RELATION_ID,
    op: OP_NAMES.keyRegisterToProxy,
    key: {
      keyId,
      publicKeyJwk,
      validFrom: '2026-02-01T00:00:00.000Z',
    },
  });

const revocationBody = (keyId: string): string =>
  JSON.stringify({
    relationId: RELATION_ID,
    op: OP_NAMES.keyRevokeToProxy,
    keyId,
  });

interface Harness {
  readonly app: Hono<SignedRequestEnv>;
  readonly prisma: DeepMockProxy<PrismaClient>;
  readonly rows: () => PeerKeyRow[];
  readonly recordFailure: ReturnType<
    typeof vi.fn<(failure: VerifyFailure, ctx: unknown) => Promise<void>>
  >;
}

const createHarness = (
  initialRows: ReadonlyArray<PeerKeyRow> = [peerKeyRow('growi-key-0001')],
): Harness => {
  const { prisma, rows } = createPrisma(initialRows);
  const seenNonces = new Set<string>();
  const recordFailure = vi.fn<
    (failure: VerifyFailure, ctx: unknown) => Promise<void>
  >(async () => undefined);

  const deps: KeyRoutesDeps = {
    signature: {
      resolvePublicKey: (): Promise<KeyObject | null> =>
        Promise.resolve(publicKey),
      consumeNonce: (ref, nonce) => {
        const token = `${ref.relationId}/${ref.keyId}/${nonce}`;
        if (seenNonces.has(token)) {
          return Promise.resolve(false);
        }
        seenNonces.add(token);
        return Promise.resolve(true);
      },
      recordFailure,
    },
    inboundFlow: createInboundFlow({
      db: prisma,
      cipher: fakeCipher,
      platform: mock<InboundFlowPlatform>(),
    }),
  };

  const app = new Hono<SignedRequestEnv>();
  registerKeyRoutes(app, deps);

  return { app, prisma, rows, recordFailure };
};

describe('POST /chat-integration/keys/register', () => {
  it('stores the key and answers ok', async () => {
    const harness = createHarness();

    const response = await harness.app.request(
      signedRequest({
        path: REGISTER_PATH,
        bodyText: registrationBody('growi-key-0002'),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(harness.rows().map((row) => row.keyId)).toEqual([
      'growi-key-0001',
      'growi-key-0002',
    ]);
  });

  it('answers ok again for a key that is already registered, writing by the unique key', async () => {
    // Not a second test of `InboundFlow`'s idempotency (that is 7.3's, and it
    // is proven where it lives) -- what is checked here is that the HTTP edge
    // does not turn a repeated registration into anything else: the second
    // request still reaches the same upsert, addressed by
    // `(relation_id, key_id)`, and no extra row appears.
    const harness = createHarness();
    const bodyText = registrationBody('growi-key-0002');

    const first = await harness.app.request(
      signedRequest({ path: REGISTER_PATH, bodyText, nonce: 'nonce-1' }),
    );
    const second = await harness.app.request(
      signedRequest({ path: REGISTER_PATH, bodyText, nonce: 'nonce-2' }),
    );

    expect(first.status).toBe(200);
    expect(await second.json()).toEqual({ status: 'ok' });
    expect(harness.rows().map((row) => row.keyId)).toEqual([
      'growi-key-0001',
      'growi-key-0002',
    ]);
    expect(harness.prisma.peerKey.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          relationId_keyId: {
            relationId: RELATION_ID,
            keyId: 'growi-key-0002',
          },
        },
      }),
    );
  });

  it("answers the flow's rejection with 200 and the protocol's own shape", async () => {
    // A rejection is an answer the protocol declares (`KeyOperationResult`),
    // not an HTTP-level failure: the request was well formed and correctly
    // signed, and the GROWI side has a field to read.
    //
    // The body below is the narrow case that reaches the flow's `invalid-key`
    // at all. `parseKeyRegistration` already applies the key-material and
    // key-id checks the flow repeats, so a wrong key type or a malformed key
    // id is refused one step earlier, with the empty 400 asserted below; a
    // `validFrom` that is a string but not a date passes the parse and is
    // judged by the flow.
    const harness = createHarness();
    const bodyText = JSON.stringify({
      relationId: RELATION_ID,
      op: OP_NAMES.keyRegisterToProxy,
      key: {
        keyId: 'growi-key-0002',
        publicKeyJwk,
        validFrom: 'the day after tomorrow',
      },
    });

    const response = await harness.app.request(
      signedRequest({ path: REGISTER_PATH, bodyText }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'rejected',
      reason: 'invalid-key',
    });
    expect(harness.prisma.peerKey.upsert).not.toHaveBeenCalled();
  });

  it('refuses a registration whose key material is not the algorithm the protocol requires', async () => {
    // Refused by `parseKeyRegistration` before the flow sees it, so it is an
    // empty 400 rather than a `rejected` body. Recorded as its own test
    // because the two answers are easy to mistake for each other.
    const harness = createHarness();
    const bodyText = JSON.stringify({
      relationId: RELATION_ID,
      op: OP_NAMES.keyRegisterToProxy,
      key: {
        keyId: 'growi-key-0002',
        // An RSA key where the protocol requires Ed25519.
        publicKeyJwk: { kty: 'RSA', n: 'AQAB', e: 'AQAB' },
        validFrom: '2026-02-01T00:00:00.000Z',
      },
    });

    const response = await harness.app.request(
      signedRequest({ path: REGISTER_PATH, bodyText }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('');
    expect(harness.prisma.peerKey.upsert).not.toHaveBeenCalled();
  });

  it('refuses an unsigned registration without storing anything', async () => {
    const harness = createHarness();

    const response = await harness.app.request(
      unsignedRequest(REGISTER_PATH, registrationBody('growi-key-0002')),
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
    expect(harness.prisma.peerKey.upsert).not.toHaveBeenCalled();
    expect(harness.recordFailure).toHaveBeenCalled();
  });

  it('refuses a correctly signed registration of the wrong shape with an empty 400', async () => {
    const harness = createHarness();
    const bodyText = JSON.stringify({
      relationId: RELATION_ID,
      op: OP_NAMES.keyRegisterToProxy,
      key: { keyId: 'growi-key-0002' }, // no publicKeyJwk, no validFrom
    });

    const response = await harness.app.request(
      signedRequest({ path: REGISTER_PATH, bodyText }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('');
    expect(harness.prisma.peerKey.upsert).not.toHaveBeenCalled();
  });
});

describe('POST /chat-integration/keys/revoke', () => {
  it('revokes the key and answers ok', async () => {
    const harness = createHarness([
      peerKeyRow('growi-key-0001'),
      peerKeyRow('growi-key-0002'),
    ]);

    const response = await harness.app.request(
      signedRequest({
        path: REVOKE_PATH,
        bodyText: revocationBody('growi-key-0002'),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(
      harness.rows().find((row) => row.keyId === 'growi-key-0002')?.revokedAt,
    ).toBeInstanceOf(Date);
  });

  it('answers ok again the second time the same revocation arrives', async () => {
    const harness = createHarness([
      peerKeyRow('growi-key-0001'),
      peerKeyRow('growi-key-0002'),
    ]);
    const bodyText = revocationBody('growi-key-0002');

    const first = await harness.app.request(
      signedRequest({ path: REVOKE_PATH, bodyText, nonce: 'nonce-1' }),
    );
    const second = await harness.app.request(
      signedRequest({ path: REVOKE_PATH, bodyText, nonce: 'nonce-2' }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ status: 'ok' });
    expect(harness.rows().filter((row) => row.revokedAt != null)).toHaveLength(
      1,
    );
  });

  it('answers the refusal that keeps the last valid key alive, with 200', async () => {
    // 「有効な鍵が 0 本になる要求は `would-leave-no-valid-key` で断る」
    // (design.md's endpoint table). The judgement is `@growi/chat`'s and is
    // tested there; what matters here is that its answer reaches the caller
    // whole instead of becoming an HTTP status.
    const harness = createHarness([peerKeyRow('growi-key-0001')]);

    const response = await harness.app.request(
      signedRequest({
        path: REVOKE_PATH,
        bodyText: revocationBody('growi-key-0001'),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'rejected',
      reason: 'would-leave-no-valid-key',
    });
    expect(harness.prisma.peerKey.update).not.toHaveBeenCalled();
  });

  it('refuses an unsigned revocation without touching a key', async () => {
    const harness = createHarness([
      peerKeyRow('growi-key-0001'),
      peerKeyRow('growi-key-0002'),
    ]);

    const response = await harness.app.request(
      unsignedRequest(REVOKE_PATH, revocationBody('growi-key-0002')),
    );

    expect(response.status).toBe(401);
    expect(harness.prisma.peerKey.update).not.toHaveBeenCalled();
  });

  it('refuses a correctly signed revocation of the wrong shape with an empty 400', async () => {
    const harness = createHarness([
      peerKeyRow('growi-key-0001'),
      peerKeyRow('growi-key-0002'),
    ]);
    const bodyText = JSON.stringify({
      relationId: RELATION_ID,
      op: OP_NAMES.keyRevokeToProxy,
      keyId: 'has:a:colon', // `isValidKeyIdShape` refuses this
    });

    const response = await harness.app.request(
      signedRequest({ path: REVOKE_PATH, bodyText }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('');
    expect(harness.prisma.peerKey.update).not.toHaveBeenCalled();
  });
});
