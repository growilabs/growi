// Task 3.5's completion criterion against a real PostgreSQL: the fake GROWI
// calls both endpoints signed, the real `signatureGuard` and the real
// `AnswerFlow` answer it, and a summary asked for outside a thread in a DM
// reads that DM's latest messages (Requirements 5.7, 5.14, 15.7).
//
// What GROWI receives is read with the protocol's own parsers
// (`sendCommandAnswer` / `requestConversation`), so a conversation GROWI would
// refuse fails here rather than in GROWI.
//
// Connection string and the "no beforeAll" arrangement are the same as
// `db/repositories/storage-round-trip.integ.ts`, for the reasons stated there.
import { randomUUID } from 'node:crypto';
import { OP_NAMES } from '@growi/chat';
import { Hono } from 'hono';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { createPrivateReplier } from '../command/index.js';
import {
  createInstallationRepository,
  createPendingAgentRequestRepository,
  createPrismaClient,
  createRelationRepository,
  type PrismaClient,
  type StoredAnswerOrigin,
} from '../db/index.js';
import { createAnswerFlow } from '../orchestration/index.js';
import {
  registerAgentInboundRoutes,
  type SignedRequestEnv,
} from '../routes/index.js';
import type { HistoryMessage, SecretCipher } from '../types/index.js';
import { actorOn, channelOn } from './chat-events.js';
import {
  type CapturedConversationRead,
  createFakeChatService,
  type FakeChatScript,
} from './fake-chat-service.js';
import { type FakeGrowi, startFakeGrowi } from './fake-growi.js';
import { serveOnFreePort } from './free-port.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chat_integration_proxy:chat_integration_proxy_dev@postgres:5432/chat_integration_proxy';

const WORKSPACE_ID = `T-${randomUUID()}`;
const DAY_MS = 24 * 60 * 60 * 1000;

const PREFIX = 'plain:';
const testCipher: SecretCipher = {
  encrypt: (plaintext) => `${PREFIX}${plaintext}`,
  decrypt: (ciphertext) => ciphertext.slice(PREFIX.length),
};

let shared: Promise<{ prisma: PrismaClient; installationId: string }> | null =
  null;

const context = (): Promise<{
  prisma: PrismaClient;
  installationId: string;
}> => {
  shared ??= (async () => {
    const prisma = createPrismaClient(DATABASE_URL);
    const installationId = await createInstallationRepository(
      prisma,
      testCipher,
    ).save('slack', WORKSPACE_ID, 'Acme', {
      slack: { botToken: `xoxb-${randomUUID()}` },
    });
    return { prisma, installationId };
  })();
  return shared;
};

afterAll(async () => {
  if (shared == null) return;
  let prisma: PrismaClient;
  let installationId: string;
  try {
    ({ prisma, installationId } = await shared);
  } catch {
    return;
  }
  const relations = await prisma.relation.findMany({
    where: { installationId },
    select: { id: true },
  });
  await prisma.pendingAgentRequest.deleteMany({
    where: { relationId: { in: relations.map((relation) => relation.id) } },
  });
  await prisma.relation.deleteMany({ where: { installationId } });
  await prisma.installation.deleteMany({ where: { id: installationId } });
  await prisma.$disconnect();
});

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const channelOrigin = (
  overrides: Partial<StoredAnswerOrigin> = {},
): StoredAnswerOrigin => ({
  channel: channelOn('slack'),
  actor: actorOn('slack'),
  sourceMessageId: 'M-1',
  threadRootId: null,
  replyThreadRootId: null,
  place: 'channel',
  requestSummary: 'agent summarize this',
  ...overrides,
});

/** A Slack DM request outside a thread: the answer goes in the thread it starts. */
const directOrigin = (): StoredAnswerOrigin => ({
  channel: channelOn('slack', { isPrivate: true, isDirectMessage: true }),
  actor: actorOn('slack'),
  sourceMessageId: 'M-dm-1',
  threadRootId: null,
  replyThreadRootId: 'M-dm-1',
  place: 'direct',
  requestSummary: 'agent summarize this conversation',
});

const said = (
  postedAt: string,
  text: string,
  author: HistoryMessage['author'] = actorOn('slack', {
    accountId: 'U-bob',
    displayName: 'Bob',
  }),
): HistoryMessage => ({ postedAt, author, text });

/**
 * The two endpoints on a real socket, behind the real guard, trusting the fake
 * GROWI's key for any relation -- which relation asks is what the body names
 * and the signature proves.
 */
const setup = async (script: FakeChatScript = {}) => {
  const { prisma, installationId } = await context();
  const relations = createRelationRepository(prisma);
  const createRelation = async () =>
    (
      await relations.create({
        installationId,
        growiUri: `https://growi-${randomUUID()}.example.com`,
        growiLabel: 'Team Wiki',
        searchWeight: 1,
        settingsVersion: 0,
      })
    ).relationId;
  const relationId = await createRelation();
  const pendingAgentRequests = createPendingAgentRequestRepository(prisma);

  const chat = createFakeChatService(script);
  const facade = await chat.createFacade(
    { stateConnectionString: 'unused' },
    { list: () => Promise.resolve([]), resolve: () => Promise.resolve(null) },
    { handle: async () => {} },
  );
  const answerFlow = createAnswerFlow({
    pendingAgentRequests,
    relations,
    privateReplier: createPrivateReplier({
      platform: facade,
      describePlace: async () => null,
      resolveInstallationId: async () => null,
      reportUndeliverable: () => {},
    }),
    platform: facade,
    reportOperationalFailure: () => {},
  });

  const growi: FakeGrowi = await startFakeGrowi();
  closers.push(growi.close);
  const spentNonces = new Set<string>();
  const routes = new Hono<SignedRequestEnv>();
  registerAgentInboundRoutes(routes, {
    signature: {
      resolvePublicKey: (ref) =>
        Promise.resolve(
          ref.keyId === growi.ownKey.keyId ? growi.ownKey.publicKey : null,
        ),
      consumeNonce: (ref, nonce) => {
        const id = `${ref.relationId}:${ref.keyId}:${nonce}`;
        const fresh = !spentNonces.has(id);
        spentNonces.add(id);
        return Promise.resolve(fresh);
      },
      recordFailure: () => Promise.resolve(),
    },
    answerFlow,
  });
  const app = new Hono();
  app.route('/', routes);
  const { server, baseUrl } = await serveOnFreePort(app);
  closers.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error == null ? resolve() : reject(error)));
      }),
  );

  const save = async (origin: StoredAnswerOrigin): Promise<string> => {
    const requestId = randomUUID();
    await pendingAgentRequests.create({
      relationId,
      requestId,
      installationId,
      origin,
      expiresAt: new Date(Date.now() + DAY_MS),
    });
    return requestId;
  };

  return {
    chat,
    growi,
    proxyBaseUrl: baseUrl,
    relationId,
    installationId,
    createRelation,
    save,
  };
};

describe('the command-answer endpoint, called signed by GROWI (Requirement 15.7)', () => {
  it('delivers the answer to the recorded requester and answers `delivered`, once', async () => {
    const { chat, growi, proxyBaseUrl, relationId, save } = await setup();
    const requestId = await save(channelOrigin());
    const answer = {
      relationId,
      requestId,
      answer: {
        kind: 'text' as const,
        markdown: 'Ship on Friday.',
        sources: [],
      },
    };

    const first = await growi.sendCommandAnswer(proxyBaseUrl, answer);
    const repeat = await growi.sendCommandAnswer(proxyBaseUrl, answer);

    expect(first).toMatchObject({
      status: 200,
      parsed: { status: 'delivered' },
    });
    expect(repeat).toMatchObject({
      status: 200,
      parsed: { status: 'delivered' },
    });
    const posts = chat.posts();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      kind: 'ephemeral',
      channel: channelOn('slack'),
      user: actorOn('slack'),
    });
  });

  it('answers `unknown-request` to an answer for a request it never recorded', async () => {
    const { chat, growi, proxyBaseUrl, relationId } = await setup();

    const answer = await growi.sendCommandAnswer(proxyBaseUrl, {
      relationId,
      requestId: randomUUID(),
      answer: { kind: 'failed', reason: 'timeout' },
    });

    expect(answer).toMatchObject({
      status: 200,
      parsed: { status: 'unknown-request' },
    });
    expect(chat.posts()).toEqual([]);
  });

  it('refuses an unsigned answer with 401 and delivers nothing', async () => {
    const { chat, proxyBaseUrl, relationId, save } = await setup();
    const requestId = await save(channelOrigin());

    const response = await fetch(
      `${proxyBaseUrl}/chat-integration/command-answer`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          relationId,
          op: OP_NAMES.commandAnswer,
          requestId,
          answer: { kind: 'failed', reason: 'timeout' },
        }),
      },
    );

    expect(response.status).toBe(401);
    expect(chat.posts()).toEqual([]);
  });
});

describe('the conversation endpoint, called signed by GROWI (Requirements 5.7, 5.14)', () => {
  it('reads the thread a request was made in and hands it over', async () => {
    const thread = [
      said('2026-11-16T08:00:00.000Z', 'which day do we ship?'),
      said('2026-11-16T08:10:00.000Z', 'Friday'),
    ];
    const { chat, growi, proxyBaseUrl, relationId, installationId, save } =
      await setup({
        fetchConversation: (read) => ({
          ok: true,
          messages: read.range.threadRootId === 'T-1' ? thread : [],
          truncated: false,
        }),
      });
    const requestId = await save(
      channelOrigin({
        sourceMessageId: 'M-in-thread',
        threadRootId: 'T-1',
        replyThreadRootId: 'T-1',
      }),
    );

    const answer = await growi.requestConversation(proxyBaseUrl, {
      relationId,
      requestId,
    });

    expect(chat.conversationReads()).toEqual<CapturedConversationRead[]>([
      {
        target: channelOn('slack'),
        range: {
          threadRootId: 'T-1',
          requestMessageId: 'M-in-thread',
          limit: 200,
        },
        installationId,
      },
    ]);
    expect(answer.status).toBe(200);
    expect(answer.parsed).toEqual({
      ok: true,
      messages: [
        {
          postedAt: '2026-11-16T08:00:00.000Z',
          author: thread[0].author,
          markdown: 'which day do we ship?',
        },
        {
          postedAt: '2026-11-16T08:10:00.000Z',
          author: thread[1].author,
          markdown: 'Friday',
        },
      ],
      range: {
        messageCount: 2,
        firstPostedAt: '2026-11-16T08:00:00.000Z',
        lastPostedAt: '2026-11-16T08:10:00.000Z',
      },
      truncated: false,
    });
  });

  it('reads the latest messages of the DM for a summary asked for outside a thread there', async () => {
    const latest = [
      said('2026-11-16T09:00:00.000Z', 'notes for the retro', actorOn('slack')),
      said(
        '2026-11-16T09:01:00.000Z',
        'the deploy took 40 minutes',
        actorOn('slack'),
      ),
    ];
    const { chat, growi, proxyBaseUrl, relationId, save } = await setup({
      // Only a read of the place's latest messages finds anything: reading the
      // thread the answer goes to would find the request alone.
      fetchConversation: (read) => ({
        ok: true,
        messages: read.range.threadRootId == null ? latest : [],
        truncated: false,
      }),
    });
    const origin = directOrigin();
    const requestId = await save(origin);

    const answer = await growi.requestConversation(proxyBaseUrl, {
      relationId,
      requestId,
    });

    expect(
      chat.conversationReads().map((read) => [read.target, read.range]),
    ).toEqual([
      [
        origin.channel,
        { threadRootId: null, requestMessageId: 'M-dm-1', limit: 200 },
      ],
    ]);
    expect(answer.status).toBe(200);
    expect(answer.parsed).toMatchObject({
      ok: true,
      messages: [
        { markdown: 'notes for the retro' },
        { markdown: 'the deploy took 40 minutes' },
      ],
      range: { messageCount: 2 },
    });
  });

  it('answers `empty` when there is no message to summarize', async () => {
    const { growi, proxyBaseUrl, relationId, save } = await setup();
    const requestId = await save(channelOrigin());

    const answer = await growi.requestConversation(proxyBaseUrl, {
      relationId,
      requestId,
    });

    expect(answer).toMatchObject({
      status: 200,
      parsed: { ok: false, failure: { reason: 'empty', remedy: null } },
    });
  });

  it('answers `unknown-request` to a request it never recorded, and to another relation asking about this one’s', async () => {
    const { chat, growi, proxyBaseUrl, relationId, createRelation, save } =
      await setup();
    const requestId = await save(channelOrigin());
    const otherRelationId = await createRelation();

    const unrecorded = await growi.requestConversation(proxyBaseUrl, {
      relationId,
      requestId: randomUUID(),
    });
    const someoneElses = await growi.requestConversation(proxyBaseUrl, {
      relationId: otherRelationId,
      requestId,
    });

    for (const answer of [unrecorded, someoneElses]) {
      expect(answer).toMatchObject({
        status: 200,
        parsed: {
          ok: false,
          failure: { reason: 'unknown-request', remedy: null },
        },
      });
    }
    expect(chat.conversationReads()).toEqual([]);
  });

  it('answers `unsupported` where the service cannot read the latest messages of a place', async () => {
    const { growi, proxyBaseUrl, relationId, save } = await setup({
      fetchConversation: (read) =>
        read.target.platform === 'mattermost' && read.range.threadRootId == null
          ? { ok: false, reason: 'unsupported', remedy: null }
          : { ok: true, messages: [], truncated: false },
    });
    const requestId = await save(
      channelOrigin({
        channel: channelOn('mattermost'),
        actor: actorOn('mattermost'),
      }),
    );

    const answer = await growi.requestConversation(proxyBaseUrl, {
      relationId,
      requestId,
    });

    expect(answer).toMatchObject({
      status: 200,
      parsed: { ok: false, failure: { reason: 'unsupported', remedy: null } },
    });
  });

  it('hands over a conversation with a 40,000-character message and a 250-character name in a shape GROWI accepts', async () => {
    const { growi, proxyBaseUrl, relationId, save } = await setup({
      fetchConversation: () => ({
        ok: true,
        messages: [
          said('2026-11-16T08:00:00.000Z', 'z'.repeat(40_000), {
            platform: 'slack',
            accountId: 'U-long',
            displayName: 'n'.repeat(250),
          }),
          said('2026-11-16T08:05:00.000Z', 'short reply'),
        ],
        truncated: false,
      }),
    });
    const requestId = await save(channelOrigin());

    const answer = await growi.requestConversation(proxyBaseUrl, {
      relationId,
      requestId,
    });

    expect(answer.status).toBe(200);
    expect(answer.parsed).toMatchObject({
      ok: true,
      messages: [
        { author: { displayName: 'n'.repeat(200) } },
        { markdown: 'short reply' },
      ],
      range: { messageCount: 2 },
    });
  });

  it('answers 500 to a read that failed for no reason it can name, with nothing of the failure in it', async () => {
    const { growi, proxyBaseUrl, relationId, save } = await setup({
      fetchConversation: () => {
        throw new Error('connect ECONNREFUSED internal-host-7');
      },
    });
    const requestId = await save(channelOrigin());

    const answer = await growi.requestConversation(proxyBaseUrl, {
      relationId,
      requestId,
    });

    expect(answer.status).toBe(500);
    expect(JSON.stringify(answer.body)).not.toContain('internal-host-7');
  });
});
