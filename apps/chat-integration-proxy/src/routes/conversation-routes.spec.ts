// Real Hono, a real Ed25519 signature from `sign()` and the real
// `signatureGuard` -- nothing here replaces verification.

import { generateKeyPairSync } from 'node:crypto';
import type { KeyRef } from '@growi/chat/server';
import { sign } from '@growi/chat/server';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { registerConversationRoutes } from './conversation-routes.js';
import type { SignedRequestEnv } from './signature-guard.js';

const PATH = '/chat-integration/conversation';
const CONTENT_TYPE = 'application/json';
const KEY: KeyRef = { relationId: 'relation-1', keyId: 'key-1' };

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

const createApp = (): Hono<SignedRequestEnv> => {
  const seenNonces = new Set<string>();
  const app = new Hono<SignedRequestEnv>();
  registerConversationRoutes(app, {
    signature: {
      resolvePublicKey: () => Promise.resolve(publicKey),
      consumeNonce: (_ref, nonce) => {
        const fresh = !seenNonces.has(nonce);
        seenNonces.add(nonce);
        return Promise.resolve(fresh);
      },
      recordFailure: () => Promise.resolve(),
    },
  });
  return app;
};

const bodyFor = (op: string): string =>
  JSON.stringify({
    relationId: KEY.relationId,
    op,
    requestId: 'req-1',
  });

const signedRequest = (bodyText: string): Request => {
  const bytes = new TextEncoder().encode(bodyText);
  const signed = sign({
    method: 'POST',
    headers: { 'content-type': CONTENT_TYPE },
    body: bytes,
    key: KEY,
    privateKey,
    expiresInSec: 60,
  });
  return new Request(`http://proxy.example${PATH}`, {
    method: 'POST',
    headers: { 'content-type': CONTENT_TYPE, ...signed.headers },
    body: bytes,
  });
};

describe('POST /chat-integration/conversation', () => {
  it('answers 501 with an empty body to a validly signed request, never pretending a conversation was read', async () => {
    const response = await createApp().request(
      signedRequest(bodyFor('conversation')),
    );

    expect(response.status).toBe(501);
    expect(await response.text()).toBe('');
  });

  it('refuses an unsigned request with 401', async () => {
    const response = await createApp().request(PATH, {
      method: 'POST',
      headers: { 'content-type': CONTENT_TYPE },
      body: bodyFor('conversation'),
    });

    expect(response.status).toBe(401);
  });

  it('refuses a signature made for another op with 401', async () => {
    const response = await createApp().request(
      signedRequest(bodyFor('command-answer')),
    );

    expect(response.status).toBe(401);
  });
});
