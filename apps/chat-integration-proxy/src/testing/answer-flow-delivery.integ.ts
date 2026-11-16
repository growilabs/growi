// Task 3.4's completion criterion against a real PostgreSQL: an answer GROWI
// sends later reaches the place and the person the request's record names,
// once -- even when the same answer arrives several times at once -- and a
// delivery left half-done is taken over after two minutes.
//
// The claim that makes "once" true is a conditional UPDATE, so only a real
// database can show it; the chat side is the fake facade under the real
// `PrivateReplier`, so what is asserted is what a chat user would see.
//
// Connection string and the "no beforeAll" arrangement are the same as
// `db/repositories/storage-round-trip.integ.ts`, for the reasons stated there.
import { randomUUID } from 'node:crypto';
import {
  type AgentAnswer,
  COMMAND_NAMES,
  type CommandAnswerRequest,
  type CommandAnswerResult,
  OP_NAMES,
} from '@growi/chat';
import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  createPrivateReplier,
  privateReplyOriginOf,
} from '../command/index.js';
import {
  createInstallationRepository,
  createPendingAgentRequestRepository,
  createPrismaClient,
  createRelationRepository,
  type PrismaClient,
  type StoredAnswerOrigin,
} from '../db/index.js';
import { createAgentFlow, createAnswerFlow } from '../orchestration/index.js';
import type {
  Invocation,
  PlatformAppConfig,
  SecretCipher,
} from '../types/index.js';
import { actorOn, channelOn } from './chat-events.js';
import {
  type CapturedPost,
  createFakeChatService,
  type FakeChatScript,
} from './fake-chat-service.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://chat_integration_proxy:chat_integration_proxy_dev@postgres:5432/chat_integration_proxy';

const WORKSPACE_ID = `T-${randomUUID()}`;

const PREFIX = 'plain:';
const testCipher: SecretCipher = {
  encrypt: (plaintext) => `${PREFIX}${plaintext}`,
  decrypt: (ciphertext) => ciphertext.slice(PREFIX.length),
};

const RECLAIM_MS = 2 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

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
  const relationIds = relations.map((relation) => relation.id);
  await prisma.pendingAgentRequest.deleteMany({
    where: { relationId: { in: relationIds } },
  });
  await prisma.relation.deleteMany({ where: { installationId } });
  await prisma.installation.deleteMany({ where: { id: installationId } });
  await prisma.$disconnect();
});

const TEXT_ANSWER: AgentAnswer = {
  kind: 'text',
  markdown: 'GROWI is a wiki.',
  sources: [],
};

const answerTo = (
  relationId: string,
  requestId: string,
  answer: AgentAnswer = TEXT_ANSWER,
): CommandAnswerRequest => ({
  op: OP_NAMES.commandAnswer,
  relationId,
  requestId,
  answer,
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
  requestSummary: 'agent what is GROWI',
  ...overrides,
});

const directOrigin = (
  platform: 'slack' | 'teams',
  replyThreadRootId: string | null,
): StoredAnswerOrigin => ({
  channel: channelOn(platform, { isPrivate: true, isDirectMessage: true }),
  actor: actorOn(platform),
  sourceMessageId: 'M-dm-1',
  threadRootId: null,
  replyThreadRootId,
  place: 'direct',
  requestSummary: 'agent what is GROWI',
});

const markdownOf = (post: CapturedPost): string =>
  post.message.kind === 'markdown' ? post.message.markdown : '';

const UNUSED_APP_CONFIG: PlatformAppConfig = {
  stateConnectionString: 'unused',
};

interface SetupOptions {
  readonly script?: FakeChatScript;
  /** Holds every post until the returned `release` is called. */
  readonly holdPosts?: boolean;
}

const setup = async (options: SetupOptions = {}) => {
  const { prisma, installationId } = await context();
  const relations = createRelationRepository(prisma);
  const relation = await relations.create({
    installationId,
    growiUri: `https://growi-${randomUUID()}.example.com`,
    growiLabel: 'Team Wiki',
    searchWeight: 1,
    settingsVersion: 0,
  });
  const pendingAgentRequests = createPendingAgentRequestRepository(prisma);
  const chat = createFakeChatService(options.script);
  const fakeFacade = await chat.createFacade(
    UNUSED_APP_CONFIG,
    { list: () => Promise.resolve([]), resolve: () => Promise.resolve(null) },
    { handle: async () => {} },
  );

  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = async <T>(call: () => Promise<T>): Promise<T> => {
    if (options.holdPosts) await gate;
    return call();
  };
  const facade: typeof fakeFacade = {
    ...fakeFacade,
    post: (...args) => held(() => fakeFacade.post(...args)),
    postInThread: (...args) => held(() => fakeFacade.postInThread(...args)),
    postEphemeral: (...args) => held(() => fakeFacade.postEphemeral(...args)),
    postDirect: (...args) => held(() => fakeFacade.postDirect(...args)),
  };

  const undeliverableReports: unknown[] = [];
  const privateReplier = createPrivateReplier({
    platform: facade,
    describePlace: async () => null,
    resolveInstallationId: async () => null,
    reportUndeliverable: (fact) => {
      undeliverableReports.push(fact);
    },
  });
  const operationalReports: string[] = [];
  const reportOperationalFailure = (message: string) => {
    operationalReports.push(message);
  };
  const flowAt = (now: Date) =>
    createAnswerFlow({
      pendingAgentRequests,
      relations,
      privateReplier,
      platform: facade,
      reportOperationalFailure,
      now: () => now,
    });

  const save = async (
    origin: StoredAnswerOrigin,
    expiresAt: Date = new Date(Date.now() + DAY_MS),
  ): Promise<string> => {
    const requestId = randomUUID();
    await pendingAgentRequests.create({
      relationId: relation.relationId,
      requestId,
      installationId,
      origin,
      expiresAt,
    });
    return requestId;
  };

  return {
    chat,
    facade,
    privateReplier,
    pendingAgentRequests,
    relations,
    relationId: relation.relationId,
    installationId,
    flow: flowAt(new Date()),
    flowAt,
    save,
    release: () => release(),
    undeliverableReports: () => [...undeliverableReports],
    operationalReports: () => [...operationalReports],
    reportOperationalFailure,
  };
};

describe('delivering an answer that arrives after the request (Requirements 15.7, 15.8, 15.11)', () => {
  describe('to the place and the person the record names', () => {
    it('shows a channel request answer to the requester alone, at the channel level', async () => {
      const { chat, flow, save, relationId } = await setup();
      const requestId = await save(channelOrigin());

      await expect(
        flow.deliver(answerTo(relationId, requestId)),
      ).resolves.toEqual({
        status: 'delivered',
      });

      const posts = chat.posts();
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({
        kind: 'ephemeral',
        channel: channelOn('slack'),
        user: actorOn('slack'),
      });
      expect(posts[0]).not.toHaveProperty('threadRootId');
      expect(markdownOf(posts[0])).toContain('GROWI is a wiki.');
      expect(markdownOf(posts[0]).split('\n')[0]).toBe(
        'GROWI「Team Wiki」からの答え:',
      );
      // A channel answer on a service with a DM to carry on in says so.
      expect(markdownOf(posts[0])).toContain('bot との DM');
    });

    it('shows a channel request made inside a thread to the requester alone, in that thread', async () => {
      const { chat, flow, save, relationId } = await setup();
      const requestId = await save(
        channelOrigin({ threadRootId: 'T-1', replyThreadRootId: 'T-1' }),
      );

      await expect(
        flow.deliver(answerTo(relationId, requestId)),
      ).resolves.toEqual({
        status: 'delivered',
      });

      expect(chat.posts()).toEqual([
        expect.objectContaining({
          kind: 'ephemeral',
          user: actorOn('slack'),
          threadRootId: 'T-1',
        }),
      ]);
    });

    it('posts a DM request answer in the request thread of that DM, as the recorded installation', async () => {
      const { chat, flow, save, relationId, installationId } = await setup();
      const origin = directOrigin('slack', 'M-dm-1');
      const requestId = await save(origin);

      await expect(
        flow.deliver(answerTo(relationId, requestId)),
      ).resolves.toEqual({
        status: 'delivered',
      });

      const posts = chat.posts();
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({
        kind: 'thread-post',
        channel: origin.channel,
        threadRootId: 'M-dm-1',
        installationId,
      });
      expect(markdownOf(posts[0])).toContain('GROWI is a wiki.');
      // Already where the person can carry on: no pointer elsewhere.
      expect(markdownOf(posts[0])).not.toContain('bot との DM');
    });

    it('posts a DM request answer straight into a DM that has no threads', async () => {
      const { chat, flow, save, relationId, installationId } = await setup();
      const origin = directOrigin('teams', null);
      const requestId = await save(origin);

      await expect(
        flow.deliver(answerTo(relationId, requestId)),
      ).resolves.toEqual({
        status: 'delivered',
      });

      expect(chat.posts()).toEqual([
        expect.objectContaining({
          kind: 'post',
          channel: origin.channel,
          installationId,
        }),
      ]);
    });

    it('delivers a created-page answer and a failure answer the same way', async () => {
      const { chat, flow, save, relationId } = await setup();
      const pageRequest = await save(channelOrigin());
      const failedRequest = await save(channelOrigin());

      await flow.deliver(
        answerTo(relationId, pageRequest, {
          kind: 'page-created',
          pageUrl: 'https://wiki.example.com/page',
          range: {
            messageCount: 3,
            firstPostedAt: '2026-11-01T00:00:00.000Z',
            lastPostedAt: '2026-11-01T01:00:00.000Z',
          },
          truncated: false,
        }),
      );
      await flow.deliver(
        answerTo(relationId, failedRequest, {
          kind: 'failed',
          reason: 'timeout',
        }),
      );

      const posts = chat.posts();
      expect(posts.map((post) => [post.kind, post.user])).toEqual([
        ['ephemeral', actorOn('slack')],
        ['ephemeral', actorOn('slack')],
      ]);
      expect(markdownOf(posts[0])).toContain('https://wiki.example.com/page');
    });
  });

  describe('once, whatever arrives', () => {
    it('answers a repeat of a delivered answer with the result, without delivering again', async () => {
      const { chat, flow, save, relationId } = await setup();
      const requestId = await save(channelOrigin());
      await flow.deliver(answerTo(relationId, requestId));

      await expect(
        flow.deliver(answerTo(relationId, requestId)),
      ).resolves.toEqual({
        status: 'delivered',
      });
      expect(chat.posts()).toHaveLength(1);
    });

    it('delivers only one of five copies of an answer that arrive together', async () => {
      const { chat, flow, save, relationId, release } = await setup({
        holdPosts: true,
      });
      const requestId = await save(channelOrigin());

      const pending = Array.from({ length: 5 }, () =>
        flow.deliver(answerTo(relationId, requestId)),
      );
      const settled: CommandAnswerResult[] = [];
      for (const delivery of pending) {
        void delivery.then((result) => settled.push(result));
      }
      // The winner is held inside its post, so the other four can only finish
      // by seeing its claim -- not by arriving after it is done.
      await vi.waitFor(() => expect(settled).toHaveLength(4), {
        timeout: 5_000,
      });
      release();
      const results = await Promise.all(pending);

      expect(chat.posts()).toHaveLength(1);
      expect(results.map((result) => result.status).sort()).toEqual([
        'delivered',
        'in-progress',
        'in-progress',
        'in-progress',
        'in-progress',
      ]);
    });

    it('records an answer that could not be delivered, and does not try again', async () => {
      const {
        chat,
        flow,
        save,
        relationId,
        undeliverableReports,
        operationalReports,
      } = await setup({
        script: {
          postEphemeral: () => ({
            ok: false,
            reason: 'platform-error',
            detail: 'refused',
          }),
          postDirect: () => ({ ok: false, detail: 'refused' }),
        },
      });
      const requestId = await save(channelOrigin());

      await expect(
        flow.deliver(answerTo(relationId, requestId)),
      ).resolves.toEqual({
        status: 'undeliverable',
      });
      const tried = chat.posts().length;
      expect(undeliverableReports()).toHaveLength(1);
      // Recorded once, by the private replier; the answer flow adds nothing.
      expect(operationalReports()).toEqual([]);

      await expect(
        flow.deliver(answerTo(relationId, requestId)),
      ).resolves.toEqual({
        status: 'undeliverable',
      });
      expect(chat.posts()).toHaveLength(tried);
    });

    it('records a DM answer the chat service refused as undeliverable, and tells the operator once without the failure detail', async () => {
      const { chat, flow, save, relationId, operationalReports } = await setup({
        script: {
          post: (post) =>
            post.kind === 'thread-post'
              ? {
                  ok: false,
                  reason: 'platform-error',
                  detail: 'DETAIL-xoxb-secret',
                }
              : { ok: true, messageId: 'M-x' },
        },
      });
      const origin = directOrigin('slack', 'M-dm-1');
      const requestId = await save(origin);

      await expect(
        flow.deliver(answerTo(relationId, requestId)),
      ).resolves.toEqual({
        status: 'undeliverable',
      });
      await expect(
        flow.deliver(answerTo(relationId, requestId)),
      ).resolves.toEqual({
        status: 'undeliverable',
      });
      expect(chat.posts()).toHaveLength(1);

      const reports = operationalReports();
      expect(reports).toHaveLength(1);
      expect(reports[0]).toContain('slack');
      expect(reports[0]).toContain(origin.channel.channelId);
      expect(reports[0]).toContain(requestId);
      expect(reports[0]).toContain('platform-error');
      expect(reports[0]).not.toContain('DETAIL-xoxb-secret');
    });

    it('tells the operator nothing when a DM answer is delivered', async () => {
      const { flow, save, relationId, operationalReports } = await setup();
      const threaded = await save(directOrigin('slack', 'M-dm-1'));
      const flat = await save(directOrigin('teams', null));

      await flow.deliver(answerTo(relationId, threaded));
      await flow.deliver(answerTo(relationId, flat));

      expect(operationalReports()).toEqual([]);
    });

    it('tells the operator about a DM answer refused where the DM has no threads', async () => {
      const { flow, save, relationId, operationalReports } = await setup({
        script: {
          post: () => ({
            ok: false,
            reason: 'bot-not-in-channel',
            remedy: 'REMEDY-TEXT',
          }),
        },
      });
      const requestId = await save(directOrigin('teams', null));

      await expect(
        flow.deliver(answerTo(relationId, requestId)),
      ).resolves.toEqual({ status: 'undeliverable' });

      const reports = operationalReports();
      expect(reports).toHaveLength(1);
      expect(reports[0]).toContain('bot-not-in-channel');
      expect(reports[0]).not.toContain('REMEDY-TEXT');
    });
  });

  it('answers a copy that loses the claim to a delivery which has just finished with that result', async () => {
    const {
      chat,
      flow,
      save,
      relationId,
      pendingAgentRequests,
      privateReplier,
      facade,
      reportOperationalFailure,
      relations,
    } = await setup();
    const requestId = await save(channelOrigin());
    // What a copy read before the other delivery claimed and finished.
    const before = await pendingAgentRequests.find(relationId, requestId);
    await flow.deliver(answerTo(relationId, requestId));
    let reads = 0;
    const late = createAnswerFlow({
      relations,
      pendingAgentRequests: {
        ...pendingAgentRequests,
        find: (...args) => {
          reads += 1;
          return reads === 1
            ? Promise.resolve(before)
            : pendingAgentRequests.find(...args);
        },
      },
      privateReplier,
      platform: facade,
      reportOperationalFailure,
    });

    await expect(
      late.deliver(answerTo(relationId, requestId)),
    ).resolves.toEqual({
      status: 'delivered',
    });
    expect(chat.posts()).toHaveLength(1);
  });

  describe('a delivery left half-done', () => {
    it('is waited for while its mark is under two minutes old, and taken over after', async () => {
      const { chat, flowAt, save, relationId, pendingAgentRequests } =
        await setup();
      const requestId = await save(channelOrigin());
      const stoppedAt = new Date('2026-11-16T00:00:00.000Z');
      // A delivery that claimed the answer and then stopped before posting.
      await pendingAgentRequests.claimDelivery(
        relationId,
        requestId,
        stoppedAt,
        stoppedAt,
      );

      await expect(
        flowAt(new Date(stoppedAt.getTime() + RECLAIM_MS)).deliver(
          answerTo(relationId, requestId),
        ),
      ).resolves.toEqual({ status: 'in-progress' });
      expect(chat.posts()).toHaveLength(0);

      await expect(
        flowAt(new Date(stoppedAt.getTime() + RECLAIM_MS + 1)).deliver(
          answerTo(relationId, requestId),
        ),
      ).resolves.toEqual({ status: 'delivered' });
      expect(chat.posts()).toHaveLength(1);
    });
  });

  describe('requests the proxy does not hold', () => {
    it('answers an answer to an unknown request as such, and posts nothing', async () => {
      const { chat, flow, relationId } = await setup();

      await expect(
        flow.deliver(answerTo(relationId, randomUUID())),
      ).resolves.toEqual({
        status: 'unknown-request',
      });
      expect(chat.posts()).toHaveLength(0);
    });

    it("does not deliver to another relation's request", async () => {
      const owner = await setup();
      const other = await setup();
      const requestId = await owner.save(channelOrigin());

      await expect(
        other.flow.deliver(answerTo(other.relationId, requestId)),
      ).resolves.toEqual({ status: 'unknown-request' });
      expect(other.chat.posts()).toHaveLength(0);
    });

    it('answers an answer to a request past its expiry as unknown, before it is swept', async () => {
      const { chat, flowAt, save, relationId } = await setup();
      const expiresAt = new Date('2026-11-16T00:00:00.000Z');
      const requestId = await save(channelOrigin(), expiresAt);

      await expect(
        flowAt(expiresAt).deliver(answerTo(relationId, requestId)),
      ).resolves.toEqual({ status: 'unknown-request' });
      expect(chat.posts()).toHaveLength(0);
    });
  });

  it('delivers the answer to a request GROWI did not acknowledge in time', async () => {
    const {
      chat,
      flow,
      relationId,
      installationId,
      pendingAgentRequests,
      privateReplier,
      facade,
    } = await setup();
    const requestId = randomUUID();
    const invocation: Invocation = {
      platform: 'slack',
      channel: channelOn('slack'),
      actor: actorOn('slack'),
      commandName: COMMAND_NAMES.agent,
      argsText: 'what is GROWI',
      interaction: null,
      sourceMessageId: 'M-late',
    };
    await createAgentFlow({
      growiClient: {
        sendCommand: async () => ({ ok: false, reason: 'unreachable' }),
      },
      pendingAgentRequests,
      privateReplier,
      platform: facade,
      reportOperationalFailure: () => {},
      newRequestId: () => requestId,
    })({
      invocation,
      origin: privateReplyOriginOf(invocation, installationId),
      relation: {
        relationId,
        installationId,
        growiUri: 'https://growi.example.com',
        growiLabel: 'Team Wiki',
        searchWeight: 1,
        settingsVersion: 0,
        createdAt: new Date(),
      },
      text: 'what is GROWI',
      conversationKey: 'slack:C1:M-late',
    });
    const before = chat.posts().length;

    await expect(
      flow.deliver(answerTo(relationId, requestId)),
    ).resolves.toEqual({
      status: 'delivered',
    });

    const delivered = chat.posts().slice(before);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      kind: 'ephemeral',
      user: actorOn('slack'),
    });
    expect(markdownOf(delivered[0])).toContain('GROWI is a wiki.');
  });
});
