import { generateKeyPairSync } from 'node:crypto';
import type { IncomingHttpHeaders, Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  AgentAnswer,
  CommandAnswerResult,
  ConversationResult,
} from '@growi/chat';
import { OP_NAMES, toNativeChannelId } from '@growi/chat';
import { verify } from '@growi/chat/server';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import { storeOwnKey } from './keys';
import type { ChatKeyEncryptionEnv } from './keys/key-encryption';
import { ChatRelation } from './models/chat-relation';
import {
  fetchCapabilities,
  fetchChannels,
  fetchConnectionStatus,
  fetchConversation,
  notify,
  OP_DEADLINES_MS,
  pushSettings,
  registerKeyWithProxy,
  revokeKeyWithProxy,
  sendCommandAnswer,
} from './proxy-client';

// Real HTTP against a loopback fake proxy (no module mocks): the deadline is
// an AbortSignal.timeout, which vitest fake timers cannot drive.

const TEST_ENCRYPTION_KEY: ChatKeyEncryptionEnv = {
  CHAT_INTEGRATION_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
};

interface ReceivedRequest {
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

type Responder = (
  received: ReceivedRequest,
  respond: (status: number, body: string) => void,
) => void;

describe('proxy-client against a loopback proxy', () => {
  let mongod: MongoMemoryServer | undefined;
  let server: Server;
  let proxyUri: string;
  let responder: Responder;
  let received: ReceivedRequest[];
  const previousEnv = { ...process.env };

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_proxy_client_loopback',
    ));
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const request: ReceivedRequest = {
          url: req.url ?? '',
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        };
        received.push(request);
        responder(request, (status, body) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(body);
        });
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    proxyUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    received = [];
    responder = () => {};
    await ChatRelation.deleteMany({});
    Object.assign(process.env, TEST_ENCRYPTION_KEY);
  });

  afterEach(() => {
    process.env = { ...previousEnv };
    server.closeAllConnections();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await disconnectSelfContainedMongo(mongod);
  });

  const setUpRelation = async (relationId: string) => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    await ChatRelation.create({
      relationId,
      proxyUri,
      platform: 'slack',
      workspaceId: 'workspace-1',
      workspaceName: 'Workspace One',
      label: null,
      state: 'active',
      settingsVersion: 0,
      createdAt: new Date(),
    });
    await storeOwnKey({ relationId, keyId: `${relationId}-key` }, privateKey);
    return { publicKey };
  };

  const stringHeaders = (headers: IncomingHttpHeaders) =>
    Object.fromEntries(
      Object.entries(headers).filter(
        (e): e is [string, string] => typeof e[1] === 'string',
      ),
    );

  const publicKeyJwk = generateKeyPairSync('ed25519').publicKey.export({
    format: 'jwk',
  });

  const answer: AgentAnswer = {
    kind: 'text',
    markdown: 'the answer',
    sources: [{ title: 'Page', url: 'https://growi.example.com/page' }],
  };

  describe('sendCommandAnswer', () => {
    it.each([
      'delivered',
      'undeliverable',
      'unknown-request',
      'in-progress',
    ] as const)('returns the parsed %s result, and sends a signed body the proxy can verify', async (status) => {
      const relationId = `relation-answer-${status}`;
      const { publicKey } = await setUpRelation(relationId);
      const result: CommandAnswerResult = { status };
      responder = (_r, respond) => respond(200, JSON.stringify(result));

      const outcome = await sendCommandAnswer(relationId, {
        requestId: 'req-1',
        answer,
      });

      expect(outcome).toEqual({ ok: true, response: result });
      expect(received).toHaveLength(1);
      expect(received[0].url).toBe('/chat-integration/command-answer');
      expect(JSON.parse(received[0].body)).toEqual({
        relationId,
        op: OP_NAMES.commandAnswer,
        requestId: 'req-1',
        answer,
      });
      const verified = await verify({
        method: 'POST',
        headers: stringHeaders(received[0].headers),
        body: Buffer.from(received[0].body, 'utf8'),
        resolvePublicKey: async () => publicKey,
        consumeNonce: async () => true,
      });
      expect(verified.ok).toBe(true);
    });

    it('reports a body that is not a CommandAnswerResult as malformed-response', async () => {
      await setUpRelation('relation-answer-bad');
      responder = (_r, respond) =>
        respond(200, JSON.stringify({ status: 'sent-somewhere' }));

      const outcome = await sendCommandAnswer('relation-answer-bad', {
        requestId: 'req-1',
        answer,
      });

      expect(outcome).toEqual({ ok: false, reason: 'malformed-response' });
    });
  });

  describe('fetchConversation', () => {
    it('returns the parsed success, and sends a signed body the proxy can verify', async () => {
      const relationId = 'relation-conversation-ok';
      const { publicKey } = await setUpRelation(relationId);
      const result: ConversationResult = {
        ok: true,
        messages: [
          {
            postedAt: '2026-01-01T00:00:00.000Z',
            author: { platform: 'slack', accountId: 'U1', displayName: 'Ann' },
            markdown: 'hello',
          },
        ],
        range: {
          messageCount: 1,
          firstPostedAt: '2026-01-01T00:00:00.000Z',
          lastPostedAt: '2026-01-01T00:00:00.000Z',
        },
        truncated: false,
      };
      responder = (_r, respond) => respond(200, JSON.stringify(result));

      const outcome = await fetchConversation(relationId, {
        requestId: 'req-2',
      });

      expect(outcome).toEqual({ ok: true, response: result });
      expect(received[0].url).toBe('/chat-integration/conversation');
      expect(JSON.parse(received[0].body)).toEqual({
        relationId,
        op: OP_NAMES.conversation,
        requestId: 'req-2',
      });
      const verified = await verify({
        method: 'POST',
        headers: stringHeaders(received[0].headers),
        body: Buffer.from(received[0].body, 'utf8'),
        resolvePublicKey: async () => publicKey,
        consumeNonce: async () => true,
      });
      expect(verified.ok).toBe(true);
    });

    it('returns a proxy-reported failure reason as a result, not as a call failure', async () => {
      await setUpRelation('relation-conversation-fail');
      const result: ConversationResult = {
        ok: false,
        failure: { reason: 'not-in-channel', remedy: 'Invite the bot.' },
      };
      responder = (_r, respond) => respond(200, JSON.stringify(result));

      const outcome = await fetchConversation('relation-conversation-fail', {
        requestId: 'req-3',
      });

      expect(outcome).toEqual({ ok: true, response: result });
    });
  });

  describe('a proxy that never answers', () => {
    const SHORT_MS = 150;
    const shortDeadlines = {
      ...OP_DEADLINES_MS,
      [OP_NAMES.notification]: SHORT_MS,
      [OP_NAMES.settingsPush]: SHORT_MS,
      [OP_NAMES.keyRegisterToProxy]: SHORT_MS,
      [OP_NAMES.keyRevokeToProxy]: SHORT_MS,
      [OP_NAMES.capabilities]: SHORT_MS,
      [OP_NAMES.connectionStatus]: SHORT_MS,
      [OP_NAMES.channels]: SHORT_MS,
      [OP_NAMES.commandAnswer]: SHORT_MS,
      [OP_NAMES.conversation]: SHORT_MS,
    };
    const options = { deadlinesMs: shortDeadlines };

    it.each([
      [
        'notify',
        (id: string) =>
          notify(
            id,
            {
              requestId: 'r',
              targets: [
                { platform: 'slack', channelId: toNativeChannelId('C1') },
              ],
              markdown: 'm',
              containsRestrictedPage: false,
            },
            options,
          ),
      ],
      [
        'pushSettings',
        (id: string) =>
          pushSettings(
            id,
            {
              settings: { relationId: id, channelPermissions: [] },
              version: 1,
            },
            options,
          ),
      ],
      [
        'registerKeyWithProxy',
        (id: string) =>
          registerKeyWithProxy(
            id,
            {
              keyId: 'k',
              publicKeyJwk: publicKeyJwk,
              validFrom: '2026-01-01T00:00:00.000Z',
            },
            options,
          ),
      ],
      [
        'revokeKeyWithProxy',
        (id: string) => revokeKeyWithProxy(id, 'k', options),
      ],
      ['fetchCapabilities', (id: string) => fetchCapabilities(id, options)],
      [
        'fetchConnectionStatus',
        (id: string) => fetchConnectionStatus(id, options),
      ],
      ['fetchChannels', (id: string) => fetchChannels(id, options)],
      [
        'sendCommandAnswer',
        (id: string) =>
          sendCommandAnswer(id, { requestId: 'r', answer }, options),
      ],
      [
        'fetchConversation',
        (id: string) => fetchConversation(id, { requestId: 'r' }, options),
      ],
    ])('%s comes back as an unreachable failure at its deadline', async (label, call) => {
      const relationId = `relation-hang-${label}`;
      await setUpRelation(relationId);
      responder = () => {};

      const startedAt = Date.now();
      const outcome = await call(relationId);

      expect(outcome).toEqual({ ok: false, reason: 'unreachable' });
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(SHORT_MS - 20);
      expect(Date.now() - startedAt).toBeLessThan(5000);
    });
  });

  describe('the production deadline table', () => {
    it('gives the notification 15 s and every other op GROWI sends 10 s', () => {
      const { [OP_NAMES.notification]: notification, ...others } =
        OP_DEADLINES_MS;
      expect(notification).toBe(15_000);
      expect(Object.values(others).every((ms) => ms === 10_000)).toBe(true);
      expect(Object.keys(others)).toEqual(
        expect.arrayContaining([
          OP_NAMES.commandAnswer,
          OP_NAMES.conversation,
          OP_NAMES.settingsPush,
          OP_NAMES.channels,
        ]),
      );
    });
  });
});
