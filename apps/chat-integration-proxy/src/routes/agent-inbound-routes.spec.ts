// Real Hono, a real Ed25519 signature from `sign()` and the real
// `signatureGuard` -- nothing here replaces verification. The flows behind the
// two endpoints are stand-ins: what is under test is what the endpoints hand
// them and what they answer GROWI with.

import { generateKeyPairSync } from 'node:crypto';
import type {
  CommandAnswerRequest,
  CommandAnswerResult,
  ConversationRequest,
  ConversationResult,
} from '@growi/chat';
import type { KeyRef } from '@growi/chat/server';
import { sign } from '@growi/chat/server';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { AnswerFlow } from '../orchestration/index.js';
import { registerAgentInboundRoutes } from './agent-inbound-routes.js';
import type { SignedRequestEnv } from './signature-guard.js';

const ANSWER_PATH = '/chat-integration/command-answer';
const CONVERSATION_PATH = '/chat-integration/conversation';
const CONTENT_TYPE = 'application/json';
const KEY: KeyRef = { relationId: 'relation-1', keyId: 'key-1' };

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

interface Script {
  readonly deliver?: (
    request: CommandAnswerRequest,
  ) => Promise<CommandAnswerResult>;
  readonly readConversation?: (
    request: ConversationRequest,
  ) => Promise<ConversationResult>;
}

const createApp = (script: Script = {}) => {
  const delivered: CommandAnswerRequest[] = [];
  const asked: ConversationRequest[] = [];
  const answerFlow: AnswerFlow = {
    deliver: async (request) => {
      delivered.push(request);
      return (await script.deliver?.(request)) ?? { status: 'delivered' };
    },
    readConversation: async (request) => {
      asked.push(request);
      return (
        (await script.readConversation?.(request)) ?? {
          ok: false,
          failure: { reason: 'empty', remedy: null },
        }
      );
    },
  };
  const seenNonces = new Set<string>();
  const app = new Hono<SignedRequestEnv>();
  registerAgentInboundRoutes(app, {
    signature: {
      resolvePublicKey: () => Promise.resolve(publicKey),
      consumeNonce: (_ref, nonce) => {
        const fresh = !seenNonces.has(nonce);
        seenNonces.add(nonce);
        return Promise.resolve(fresh);
      },
      recordFailure: () => Promise.resolve(),
    },
    answerFlow,
  });
  return { app, delivered: () => [...delivered], asked: () => [...asked] };
};

const signedRequest = (path: string, body: object): Request => {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const signed = sign({
    method: 'POST',
    headers: { 'content-type': CONTENT_TYPE },
    body: bytes,
    key: KEY,
    privateKey,
    expiresInSec: 60,
  });
  return new Request(`http://proxy.example${path}`, {
    method: 'POST',
    headers: { 'content-type': CONTENT_TYPE, ...signed.headers },
    body: bytes,
  });
};

const answerBody: CommandAnswerRequest = {
  relationId: KEY.relationId,
  op: 'command-answer',
  requestId: 'req-1',
  answer: { kind: 'text', markdown: 'an answer', sources: [] },
};

const conversationBody: ConversationRequest = {
  relationId: KEY.relationId,
  op: 'conversation',
  requestId: 'req-1',
};

describe('POST /chat-integration/command-answer (Requirement 15.7)', () => {
  it('hands a signed answer to the answer flow and answers with its result', async () => {
    const { app, delivered } = createApp({
      deliver: async () => ({ status: 'in-progress' }),
    });

    const response = await app.request(signedRequest(ANSWER_PATH, answerBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'in-progress' });
    expect(delivered()).toEqual([answerBody]);
  });

  it('answers `unknown-request` as a result, not as an HTTP error', async () => {
    const { app } = createApp({
      deliver: async () => ({ status: 'unknown-request' }),
    });

    const response = await app.request(signedRequest(ANSWER_PATH, answerBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'unknown-request' });
  });

  it('refuses a signed body that is not an answer with an empty 400, delivering nothing', async () => {
    const { app, delivered } = createApp();

    const response = await app.request(
      signedRequest(ANSWER_PATH, { ...answerBody, answer: { kind: 'poem' } }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('');
    expect(delivered()).toEqual([]);
  });

  it('refuses an unsigned request with 401, delivering nothing', async () => {
    const { app, delivered } = createApp();

    const response = await app.request(ANSWER_PATH, {
      method: 'POST',
      headers: { 'content-type': CONTENT_TYPE },
      body: JSON.stringify(answerBody),
    });

    expect(response.status).toBe(401);
    expect(delivered()).toEqual([]);
  });

  it('refuses a signature made for another op with 401', async () => {
    const { app, delivered } = createApp();

    const response = await app.request(
      signedRequest(ANSWER_PATH, { ...answerBody, op: 'notification' }),
    );

    expect(response.status).toBe(401);
    expect(delivered()).toEqual([]);
  });
});

describe('POST /chat-integration/conversation (Requirements 5.7, 5.14)', () => {
  it('hands a signed request to the answer flow and answers with the conversation it read', async () => {
    const conversation: ConversationResult = {
      ok: true,
      messages: [
        {
          postedAt: '2026-11-16T08:00:00.000Z',
          author: { platform: 'slack', accountId: 'U2', displayName: 'Bob' },
          markdown: 'ship it',
        },
      ],
      range: {
        messageCount: 1,
        firstPostedAt: '2026-11-16T08:00:00.000Z',
        lastPostedAt: '2026-11-16T08:00:00.000Z',
      },
      truncated: false,
    };
    const { app, asked } = createApp({
      readConversation: async () => conversation,
    });

    const response = await app.request(
      signedRequest(CONVERSATION_PATH, conversationBody),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(conversation);
    expect(asked()).toEqual([conversationBody]);
  });

  it('answers a conversation that could not be read as a result, not as an HTTP error', async () => {
    const { app } = createApp({
      readConversation: async () => ({
        ok: false,
        failure: { reason: 'unknown-request', remedy: null },
      }),
    });

    const response = await app.request(
      signedRequest(CONVERSATION_PATH, conversationBody),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      failure: { reason: 'unknown-request', remedy: null },
    });
  });

  it('answers 500 to a read that failed for no reason it can name, telling GROWI nothing of it', async () => {
    const { app } = createApp({
      readConversation: () =>
        Promise.reject(new Error('connect ECONNREFUSED internal-host-7')),
    });

    const response = await app.request(
      signedRequest(CONVERSATION_PATH, conversationBody),
    );

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('internal-host-7');
  });

  it('refuses a signed body that is not a conversation request with an empty 400, reading nothing', async () => {
    const { app, asked } = createApp();

    const response = await app.request(
      signedRequest(CONVERSATION_PATH, { ...conversationBody, requestId: '' }),
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('');
    expect(asked()).toEqual([]);
  });

  it('refuses an unsigned request with 401, reading nothing', async () => {
    const { app, asked } = createApp();

    const response = await app.request(CONVERSATION_PATH, {
      method: 'POST',
      headers: { 'content-type': CONTENT_TYPE },
      body: JSON.stringify(conversationBody),
    });

    expect(response.status).toBe(401);
    expect(asked()).toEqual([]);
  });

  it('refuses a signature made for another op with 401', async () => {
    const { app, asked } = createApp();

    const response = await app.request(
      signedRequest(CONVERSATION_PATH, {
        ...conversationBody,
        op: 'command-answer',
      }),
    );

    expect(response.status).toBe(401);
    expect(asked()).toEqual([]);
  });
});
