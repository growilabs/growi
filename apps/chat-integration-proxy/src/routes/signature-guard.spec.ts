// What `signatureGuard` promises to every endpoint behind it. The properties
// below are the reason design.md puts this middleware in front of the eight
// GROWI-facing endpoints instead of leaving each of them to check a signature
// its own way (Requirements 10.1-10.4, 10.7).
//
// Everything is exercised through a real Hono app with a real Ed25519
// signature produced by `sign()` from `@growi/chat/server` -- the same
// function the GROWI side uses. Nothing here mocks `verify()`: a test that
// stubbed it would still pass with the digest check deleted, which is the one
// regression this file exists to catch.

import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import type { KeyRef, VerifyFailure } from '@growi/chat/server';
import { sign } from '@growi/chat/server';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  INBOUND_OP_BY_PATH,
  type InboundRequestContext,
  type SignatureGuardDeps,
  type SignedRequestEnv,
  signatureGuard,
} from './signature-guard.js';

const NOTIFICATION_PATH = '/chat-integration/notification';
const SETTINGS_PUSH_PATH = '/chat-integration/settings-push';
const CONTENT_TYPE = 'application/json';

const KEY: KeyRef = { relationId: 'relation-1', keyId: 'key-1' };

/**
 * Every name `verify()` can report. None of them may travel back to the
 * caller -- see the test below.
 */
const ALL_VERIFY_FAILURES: readonly VerifyFailure[] = [
  'signature-mismatch',
  'digest-mismatch',
  'expired',
  'replayed',
  'unknown-key',
  'malformed',
];

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

interface SignedRequest {
  readonly request: Request;
  readonly signatureHeader: string;
  readonly bodyText: string;
}

const signRequest = (options: {
  readonly path: string;
  readonly bodyText: string;
  readonly expiresInSec?: number;
  readonly nonce?: string;
  readonly mutateBody?: boolean;
}): SignedRequest => {
  const signedBytes = new TextEncoder().encode(options.bodyText);
  const signed = sign({
    method: 'POST',
    headers: { 'content-type': CONTENT_TYPE },
    body: signedBytes,
    key: KEY,
    privateKey,
    expiresInSec: options.expiresInSec ?? 60,
    nonce: options.nonce,
  });

  // The bytes that travel are the bytes that were signed, unless the test
  // deliberately changes one of them.
  const sentBytes = Uint8Array.from(signedBytes);
  if (options.mutateBody === true) {
    sentBytes[sentBytes.length - 2] ^= 0x01;
  }

  return {
    request: new Request(`http://proxy.example${options.path}`, {
      method: 'POST',
      headers: { 'content-type': CONTENT_TYPE, ...signed.headers },
      body: sentBytes,
    }),
    signatureHeader: signed.headers.signature,
    bodyText: options.bodyText,
  };
};

const notificationBody = (
  overrides: { readonly relationId?: string; readonly op?: string } = {},
): string =>
  JSON.stringify({
    relationId: overrides.relationId ?? KEY.relationId,
    op: overrides.op ?? 'notification',
    requestId: 'req-1',
    targets: [],
  });

interface Harness {
  readonly app: Hono<SignedRequestEnv>;
  readonly deps: SignatureGuardDeps;
  readonly resolvePublicKey: ReturnType<
    typeof vi.fn<(ref: KeyRef) => Promise<KeyObject | null>>
  >;
  readonly consumeNonce: ReturnType<
    typeof vi.fn<
      (ref: KeyRef, nonce: string, expiresAt: Date) => Promise<boolean>
    >
  >;
  readonly recordFailure: ReturnType<
    typeof vi.fn<
      (failure: VerifyFailure, ctx: InboundRequestContext) => Promise<void>
    >
  >;
  readonly handled: Array<{
    readonly key: KeyRef;
    readonly body: unknown;
    readonly path: string;
  }>;
}

const createHarness = (
  overrides: {
    readonly resolvedKey?: KeyObject | null;
    /** Mounts the guard on a path the endpoint table does not name. */
    readonly extraPath?: string;
  } = {},
): Harness => {
  const seenNonces = new Set<string>();

  const resolvePublicKey = vi.fn<(ref: KeyRef) => Promise<KeyObject | null>>(
    async () =>
      overrides.resolvedKey === undefined ? publicKey : overrides.resolvedKey,
  );
  // The real repository's contract: `true` the first time the triple is seen,
  // `false` on every repeat.
  const consumeNonce = vi.fn<
    (ref: KeyRef, nonce: string, expiresAt: Date) => Promise<boolean>
  >((ref, nonce) => {
    const token = `${ref.relationId}/${ref.keyId}/${nonce}`;
    if (seenNonces.has(token)) {
      return Promise.resolve(false);
    }
    seenNonces.add(token);
    return Promise.resolve(true);
  });
  const recordFailure = vi.fn<
    (failure: VerifyFailure, ctx: InboundRequestContext) => Promise<void>
  >(async () => undefined);

  const deps: SignatureGuardDeps = {
    resolvePublicKey,
    consumeNonce,
    recordFailure,
  };
  const handled: Harness['handled'] = [];

  const app = new Hono<SignedRequestEnv>();
  const paths = [
    NOTIFICATION_PATH,
    SETTINGS_PUSH_PATH,
    ...(overrides.extraPath == null ? [] : [overrides.extraPath]),
  ];
  for (const path of paths) {
    app.post(path, signatureGuard(deps), (c) => {
      handled.push({
        key: c.get('verifiedKey'),
        body: c.get('verifiedBody'),
        path,
      });
      return c.body(null, 204);
    });
  }

  return { app, deps, resolvePublicKey, consumeNonce, recordFailure, handled };
};

describe('INBOUND_OP_BY_PATH', () => {
  it('names every endpoint GROWI signs a request to, and only those', () => {
    expect([...INBOUND_OP_BY_PATH.entries()].sort()).toEqual(
      [
        [NOTIFICATION_PATH, 'notification'],
        [SETTINGS_PUSH_PATH, 'settings-push'],
        ['/chat-integration/keys/register', 'key-register-to-proxy'],
        ['/chat-integration/keys/revoke', 'key-revoke-to-proxy'],
        ['/chat-integration/capabilities', 'capabilities'],
        ['/chat-integration/connection-status', 'connection-status'],
        ['/chat-integration/channels', 'channels'],
      ].sort(),
    );
  });

  it('holds paths a route can be registered on, not templates', () => {
    // The derivation strips `{proxyUri}` off each template; a row whose
    // template did not carry that prefix would otherwise reach the router as
    // a path no request can ever match.
    for (const path of INBOUND_OP_BY_PATH.keys()) {
      expect(path.startsWith('/')).toBe(true);
      expect(path).not.toContain('{');
    }
  });
});

describe('signatureGuard', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('lets a correctly signed request through, with the verified key and body', async () => {
    const harness = createHarness();
    const { request } = signRequest({
      path: NOTIFICATION_PATH,
      bodyText: notificationBody(),
    });

    const response = await harness.app.request(request);

    expect(response.status).toBe(204);
    expect(harness.handled).toHaveLength(1);
    expect(harness.handled[0]?.key).toEqual(KEY);
    expect(harness.handled[0]?.body).toMatchObject({
      relationId: KEY.relationId,
      op: 'notification',
      requestId: 'req-1',
    });
    expect(harness.recordFailure).not.toHaveBeenCalled();
  });

  it('verifies the bytes as received, not a re-serialized body', async () => {
    // Whitespace and key order no `JSON.stringify` would produce: if the guard
    // parsed the body and handed the rebuilt bytes to `verify`, the digest
    // would no longer match and a legitimate peer would be refused.
    const harness = createHarness();
    const { request } = signRequest({
      path: NOTIFICATION_PATH,
      bodyText: '{"op":"notification" ,   "relationId":"relation-1"}',
    });

    const response = await harness.app.request(request);

    expect(response.status).toBe(204);
    expect(harness.handled).toHaveLength(1);
  });

  it('refuses a body changed by a single byte after signing', async () => {
    const harness = createHarness();
    const { request } = signRequest({
      path: NOTIFICATION_PATH,
      bodyText: notificationBody(),
      mutateBody: true,
    });

    const response = await harness.app.request(request);

    expect(response.status).toBe(401);
    expect(harness.handled).toHaveLength(0);
    expect(harness.recordFailure).toHaveBeenCalledWith(
      'digest-mismatch',
      expect.anything(),
    );
  });

  it('spends no nonce on a request whose signature did not pass', async () => {
    const harness = createHarness();
    const { request } = signRequest({
      path: NOTIFICATION_PATH,
      bodyText: notificationBody(),
      mutateBody: true,
    });

    await harness.app.request(request);

    expect(harness.consumeNonce).not.toHaveBeenCalled();
  });

  it('refuses a request whose validity period has passed', async () => {
    const harness = createHarness();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() - 10 * 60 * 1000));
    const { request } = signRequest({
      path: NOTIFICATION_PATH,
      bodyText: notificationBody(),
    });
    vi.useRealTimers();

    const response = await harness.app.request(request);

    expect(response.status).toBe(401);
    expect(harness.handled).toHaveLength(0);
    expect(harness.recordFailure).toHaveBeenCalledWith(
      'expired',
      expect.anything(),
    );
  });

  it('refuses the second arrival of the same request', async () => {
    const harness = createHarness();
    const first = signRequest({
      path: NOTIFICATION_PATH,
      bodyText: notificationBody(),
      nonce: 'nonce-reused',
    });
    const second = signRequest({
      path: NOTIFICATION_PATH,
      bodyText: notificationBody(),
      nonce: 'nonce-reused',
    });

    const firstResponse = await harness.app.request(first.request);
    const secondResponse = await harness.app.request(second.request);

    expect(firstResponse.status).toBe(204);
    expect(secondResponse.status).toBe(401);
    expect(harness.handled).toHaveLength(1);
    expect(harness.recordFailure).toHaveBeenCalledWith(
      'replayed',
      expect.anything(),
    );
  });

  it('refuses a request whose key it does not hold', async () => {
    const harness = createHarness({ resolvedKey: null });
    const { request } = signRequest({
      path: NOTIFICATION_PATH,
      bodyText: notificationBody(),
    });

    const response = await harness.app.request(request);

    expect(response.status).toBe(401);
    expect(harness.handled).toHaveLength(0);
    expect(harness.recordFailure).toHaveBeenCalledWith(
      'unknown-key',
      expect.anything(),
    );
  });

  it('tells the refused caller nothing about why it was refused', async () => {
    // The umbrella spec's Security Considerations forbid returning the detail
    // of a failed verification to the caller. Telling an unauthenticated
    // caller `unknown-key` rather than `signature-mismatch` would let it find
    // out which `(relationId, keyId)` pairs exist, and `replayed` rather than
    // `expired` would reveal what the nonce store holds. The kind goes to
    // `recordFailure` and nowhere else.
    const harness = createHarness({ resolvedKey: null });
    const { request } = signRequest({
      path: NOTIFICATION_PATH,
      bodyText: notificationBody(),
    });

    const response = await harness.app.request(request);

    expect(response.status).toBe(401);
    const bodyText = await response.text();
    for (const failure of ALL_VERIFY_FAILURES) {
      expect(bodyText).not.toContain(failure);
    }
    expect(harness.recordFailure).toHaveBeenCalledWith(
      'unknown-key',
      expect.anything(),
    );
  });

  it('hands the nonce store its own capped expiry, not the sender’s', async () => {
    const harness = createHarness();
    const beforeSec = Math.floor(Date.now() / 1000);
    const { request } = signRequest({
      path: NOTIFICATION_PATH,
      // A day, where this side accepts at most 300 seconds.
      bodyText: notificationBody(),
      expiresInSec: 24 * 60 * 60,
    });
    const afterSec = Math.floor(Date.now() / 1000);

    await harness.app.request(request);

    expect(harness.consumeNonce).toHaveBeenCalledTimes(1);
    const expiresAt = harness.consumeNonce.mock.calls[0]?.[2];
    expect(expiresAt).toBeInstanceOf(Date);
    const expiresAtSec = (expiresAt as Date).getTime() / 1000;
    expect(expiresAtSec).toBeGreaterThanOrEqual(beforeSec + 300);
    expect(expiresAtSec).toBeLessThanOrEqual(afterSec + 300);
  });

  it('looks the nonce up by the relation and key the signature named', async () => {
    const harness = createHarness();
    const { request } = signRequest({
      path: NOTIFICATION_PATH,
      bodyText: notificationBody(),
      nonce: 'nonce-a',
    });

    await harness.app.request(request);

    expect(harness.consumeNonce).toHaveBeenCalledWith(
      KEY,
      'nonce-a',
      expect.any(Date),
    );
    expect(harness.resolvePublicKey).toHaveBeenCalledWith(KEY);
  });

  it('records the failure kind without the signature or the body', async () => {
    const harness = createHarness({ resolvedKey: null });
    const signed = signRequest({
      path: NOTIFICATION_PATH,
      bodyText: notificationBody(),
    });

    await harness.app.request(signed.request);

    expect(harness.recordFailure).toHaveBeenCalledTimes(1);
    const [failure, ctx] = harness.recordFailure.mock.calls[0] ?? [];
    expect(failure).toBe('unknown-key');
    expect(Object.keys(ctx ?? {}).sort()).toEqual([
      'method',
      'path',
      'receivedAt',
    ]);
    expect(ctx).toMatchObject({
      method: 'POST',
      path: NOTIFICATION_PATH,
    });
    const recorded = JSON.stringify(ctx);
    expect(recorded).not.toContain(signed.signatureHeader);
    expect(recorded).not.toContain('req-1');
  });

  it('refuses a body claiming an op other than the endpoint it reached', async () => {
    const harness = createHarness();
    // Validly signed -- the signature covers neither the URL nor the path, so
    // only the body's `op` ties a signature to one endpoint.
    const { request } = signRequest({
      path: NOTIFICATION_PATH,
      bodyText: notificationBody({ op: 'settings-push' }),
    });

    const response = await harness.app.request(request);

    expect(response.status).toBe(401);
    expect(harness.handled).toHaveLength(0);
    expect(harness.recordFailure).toHaveBeenCalledWith(
      'malformed',
      expect.anything(),
    );
  });

  it('refuses a body claiming a relation other than the one that signed it', async () => {
    const harness = createHarness();
    const { request } = signRequest({
      path: NOTIFICATION_PATH,
      bodyText: notificationBody({ relationId: 'relation-2' }),
    });

    const response = await harness.app.request(request);

    expect(response.status).toBe(401);
    expect(harness.handled).toHaveLength(0);
    expect(harness.recordFailure).toHaveBeenCalledWith(
      'malformed',
      expect.anything(),
    );
  });

  it('refuses a body that is not a signed envelope at all', async () => {
    const harness = createHarness();
    const { request } = signRequest({
      path: NOTIFICATION_PATH,
      bodyText: '[]',
    });

    const response = await harness.app.request(request);

    expect(response.status).toBe(401);
    expect(harness.handled).toHaveLength(0);
    expect(harness.recordFailure).toHaveBeenCalledWith(
      'malformed',
      expect.anything(),
    );
  });

  it('refuses a request on a path the endpoint table does not name', async () => {
    const harness = createHarness({ extraPath: '/chat-integration/unlisted' });
    const { request } = signRequest({
      path: '/chat-integration/unlisted',
      bodyText: notificationBody(),
    });

    const response = await harness.app.request(request);

    expect(response.status).toBe(401);
    expect(harness.handled).toHaveLength(0);
    expect(harness.recordFailure).toHaveBeenCalledWith(
      'malformed',
      expect.anything(),
    );
  });

  it('refuses a request carrying no signature', async () => {
    const harness = createHarness();
    const response = await harness.app.request(
      new Request(`http://proxy.example${NOTIFICATION_PATH}`, {
        method: 'POST',
        headers: { 'content-type': CONTENT_TYPE },
        body: notificationBody(),
      }),
    );

    expect(response.status).toBe(401);
    expect(harness.handled).toHaveLength(0);
    expect(harness.recordFailure).toHaveBeenCalledWith(
      'malformed',
      expect.anything(),
    );
  });

  it('still refuses the request when recording the failure fails', async () => {
    const harness = createHarness({ resolvedKey: null });
    harness.recordFailure.mockRejectedValueOnce(new Error('log store down'));
    const { request } = signRequest({
      path: NOTIFICATION_PATH,
      bodyText: notificationBody(),
    });

    const response = await harness.app.request(request);

    expect(response.status).toBe(401);
    expect(harness.handled).toHaveLength(0);
  });
});
