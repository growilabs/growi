// Running an accepted `agent` request to its answer (design.md
// RunAgentRequest): the answer is written to the outbox before the row is
// finished, every failure still produces an answer (Requirement 15.10), and
// the whole run is bounded by a deadline. GROWI's AI and the proxy are fakes;
// the request rows and the outbox rows are real, with the indexes the
// migrations create.

import {
  type AgentAnswer,
  type ChannelRef,
  type ChatAccountRef,
  type ConversationMessage,
  type ConversationResult,
  parseCommandAnswerRequest,
  toNativeChannelId,
} from '@growi/chat';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import { mock } from 'vitest-mock-extended';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import userModelFactory from '~/server/models/user';
import { UserStatus } from '~/server/models/user/conts';

import { ChatAccountLink } from '../account-link/models/chat-account-link';
import { resolveActor } from '../command/resolve-actor';
import type { ChatOutbox } from '../outbox';
import { createChatOutbox } from '../outbox/chat-outbox';
import { ChatOutboxRow } from '../outbox/models/chat-outbox';
import type { OutboxDispatcher } from '../outbox/outbox-dispatcher';
import type { ProxyCallResult } from '../proxy-client';
import type {
  GrowiAiGateway,
  GrowiAiRunOutcome,
} from './growi-ai-gateway-types';
import {
  ChatAgentRequest,
  type ChatAgentRequestDocument,
} from './models/chat-agent-request';
import {
  type AgentRunnerDeps,
  createAgentRequestRunner,
} from './run-agent-request';
import type { SummaryPageResult } from './summary-page';

const logged = vi.hoisted((): unknown[][] => []);
vi.mock('~/utils/logger', () => ({
  default: () => {
    const record = (...args: unknown[]) => {
      logged.push(args);
    };
    return {
      trace: record,
      debug: record,
      info: record,
      warn: record,
      error: record,
      fatal: record,
    };
  },
}));

const RELATION_ID = 'relation-run';
const SITE_URL = 'https://wiki.example.test';
const CHANNEL: ChannelRef = {
  platform: 'slack',
  channelId: toNativeChannelId('C0RUN'),
  channelName: 'run-channel',
  isPrivate: false,
};
const QUESTION = 'secret-question-text: what did we decide about the launch?';
const CONVERSATION: ConversationMessage[] = [
  {
    postedAt: '2026-11-16T09:00:00.000Z',
    author: { platform: 'slack', accountId: 'U1', displayName: 'Ann' },
    markdown: 'secret-message-one: ship on Friday',
  },
  {
    postedAt: '2026-11-16T09:05:00.000Z',
    author: { platform: 'slack', accountId: 'U2', displayName: 'Bob' },
    markdown: 'secret-message-two: agreed',
  },
];

let seq = 0;

// biome-ignore lint/suspicious/noExplicitAny: crowi-wired factory, no exported document type
const getUserModel = (): any => mongoose.model('User');

const nextActor = (): ChatAccountRef => {
  seq += 1;
  return {
    platform: 'slack',
    accountId: `U0RUN-${seq}`,
    displayName: `Asker ${seq}`,
  };
};

const createUser = (
  overrides: { status?: number; readOnly?: boolean } = {},
) => {
  seq += 1;
  return getUserModel().create({
    name: `runner ${seq}`,
    username: `runner-${seq}`,
    status: overrides.status ?? UserStatus.STATUS_ACTIVE,
    readOnly: overrides.readOnly ?? false,
  });
};

const link = (actor: ChatAccountRef, userId: mongoose.Types.ObjectId) =>
  ChatAccountLink.create({
    relationId: RELATION_ID,
    userId,
    platform: actor.platform,
    accountId: actor.accountId,
    linkedAt: new Date(),
  });

/** A running row of a linked, active user, as the accept path stores it. */
const acceptedRequest = async (
  options: { text?: string; userOverrides?: { readOnly?: boolean } } = {},
) => {
  const actor = nextActor();
  const user = await createUser(options.userOverrides);
  await link(actor, user._id);
  seq += 1;
  const row = await ChatAgentRequest.create({
    relationId: RELATION_ID,
    requestId: `req-run-${seq}`,
    userId: user._id,
    text: options.text ?? QUESTION,
    conversationKey: `slack:${CHANNEL.channelId}:1700000000.${seq}`,
    actor,
    channel: CHANNEL,
    auditContext: {
      requestArrivedAt: new Date(),
      endpoint: `chat-channel=slack:${CHANNEL.channelId} (run-channel)`,
    },
  });
  return { row, user, actor };
};

const completed = <T>(value: T): GrowiAiRunOutcome<T> => ({
  kind: 'completed',
  value,
});
const ABORTED = { kind: 'aborted' } as const;

const untilAborted = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', () => resolve(), { once: true });
  });

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const conversationOk = (
  messages: ReadonlyArray<ConversationMessage>,
  truncated = false,
): ProxyCallResult<ConversationResult> => ({
  ok: true,
  response: {
    ok: true,
    messages,
    // Deliberately wrong: GROWI recounts instead of trusting the proxy.
    range: {
      messageCount: 99,
      firstPostedAt: '2000-01-01T00:00:00.000Z',
      lastPostedAt: '2000-01-01T00:00:00.000Z',
    },
    truncated,
  },
});

const noopDispatcher = mock<OutboxDispatcher>({
  requestDrain: vi.fn(async () => {}),
});

interface Harness {
  readonly deps: AgentRunnerDeps;
  readonly gateway: ReturnType<typeof mock<GrowiAiGateway>>;
  readonly fetchConversation: ReturnType<
    typeof vi.fn<AgentRunnerDeps['fetchConversation']>
  >;
  readonly createSummaryPage: ReturnType<
    typeof vi.fn<AgentRunnerDeps['createSummaryPage']>
  >;
  readonly isAiReady: ReturnType<typeof vi.fn<() => boolean>>;
}

const harness = (overrides: Partial<AgentRunnerDeps> = {}): Harness => {
  const gateway = mock<GrowiAiGateway>();
  gateway.classify.mockResolvedValue(completed({ intent: 'answer' }));
  gateway.answer.mockResolvedValue(
    completed({ markdown: 'The launch is on Friday.', sources: [] }),
  );
  gateway.summarize.mockResolvedValue(
    completed({ title: 'Launch decision', body: 'secret-summary-body' }),
  );
  const fetchConversation = vi.fn<AgentRunnerDeps['fetchConversation']>(
    async () => conversationOk(CONVERSATION),
  );
  const createSummaryPage = vi.fn<AgentRunnerDeps['createSummaryPage']>(
    async (): Promise<SummaryPageResult> => ({
      kind: 'created',
      pageId: '0123456789abcdef01234567',
      path: '/user/someone/memo/2026-11-17 Launch decision',
    }),
  );
  const isAiReady = vi.fn(() => true);
  const deps: AgentRunnerDeps = {
    gateway,
    fetchConversation,
    outbox: createChatOutbox({ dispatcher: noopDispatcher }),
    requests: ChatAgentRequest,
    resolveActor,
    isAiReady,
    createSummaryPage,
    siteUrl: () => SITE_URL,
    now: () => new Date('2026-11-17T10:00:00.000Z'),
    ...overrides,
  };
  return { deps, gateway, fetchConversation, createSummaryPage, isAiReady };
};

const summaryRequested = (h: Harness, path: string | null = null) => {
  h.gateway.classify.mockResolvedValue(
    completed({ intent: 'summarize-to-page', path }),
  );
};

/** The single answer stored for the row; also proves the proxy would accept it. */
const storedAnswer = async (
  row: ChatAgentRequestDocument,
): Promise<AgentAnswer> => {
  const rows = await ChatOutboxRow.find({
    kind: 'command-answer',
    relationId: row.relationId,
    requestId: row.requestId,
  }).lean();
  expect(rows).toHaveLength(1);
  const { answer } = rows[0];
  expect(answer).toBeDefined();
  const parsed = parseCommandAnswerRequest({
    relationId: row.relationId,
    op: 'command-answer',
    requestId: row.requestId,
    answer,
  });
  expect(parsed).not.toHaveProperty('error');
  return answer as AgentAnswer;
};

const stateOf = async (row: ChatAgentRequestDocument) =>
  (await ChatAgentRequest.findById(row._id).lean())?.state;

describe('runAgentRequest', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_run_agent_request',
    ));
    userModelFactory(null);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    logged.length = 0;
    await Promise.all([
      ChatAccountLink.deleteMany({}),
      ChatAgentRequest.deleteMany({}),
      ChatOutboxRow.deleteMany({}),
      getUserModel().deleteMany({}),
    ]);
    const answerIndex = await import(
      '~/migrations/20261116120000-add-kind-to-chat-notification-outbox'
    );
    await answerIndex.up(mongoose.connection.db);
    const requestIndexes = await import(
      '~/migrations/20261116140000-add-chat-agent-request-indexes'
    );
    await requestIndexes.up(mongoose.connection.db);
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  describe('a question (Requirement 15.2)', () => {
    it('stores a text answer with its sources and finishes the row', async () => {
      const { row } = await acceptedRequest();
      const h = harness();
      h.gateway.answer.mockResolvedValue(
        completed({
          markdown: 'The launch is on Friday.',
          sources: [
            {
              title: 'Launch plan',
              url: `${SITE_URL}/0123456789abcdef01234568`,
            },
          ],
        }),
      );

      await createAgentRequestRunner(h.deps)(row);

      expect(await storedAnswer(row)).toEqual({
        kind: 'text',
        markdown: 'The launch is on Friday.',
        sources: [
          { title: 'Launch plan', url: `${SITE_URL}/0123456789abcdef01234568` },
        ],
      });
      expect(await stateOf(row)).toBe('done');
      expect(h.gateway.answer).toHaveBeenCalledWith(
        {
          text: QUESTION,
          relationId: RELATION_ID,
          conversationKey: row.conversationKey,
        },
        expect.anything(),
      );
    });

    it('asks GROWI AI as the linked user, as a full user document', async () => {
      const { row, user } = await acceptedRequest();
      const h = harness();

      await createAgentRequestRunner(h.deps)(row);

      const [, context] = h.gateway.answer.mock.calls[0];
      const aiUser: unknown = context.user;
      expect(aiUser).toBeInstanceOf(getUserModel());
      expect(String(context.user._id)).toBe(String(user._id));
      expect(context.user.username).toBe(user.username);
    });
  });

  describe('a summary request (Requirement 5.8)', () => {
    it('reads the conversation, creates the page as the linked user and stores its permalink', async () => {
      const { row, user } = await acceptedRequest({
        text: 'summarize this into /team/notes',
      });
      const h = harness();
      summaryRequested(h, '/team/notes');

      await createAgentRequestRunner(h.deps)(row);

      expect(h.fetchConversation).toHaveBeenCalledWith(RELATION_ID, {
        requestId: row.requestId,
      });
      expect(h.gateway.summarize).toHaveBeenCalledWith(
        CONVERSATION,
        'summarize this into /team/notes',
        expect.anything(),
      );
      expect(h.createSummaryPage).toHaveBeenCalledTimes(1);
      const [params] = h.createSummaryPage.mock.calls[0];
      expect(params).toMatchObject({
        requestedPath: '/team/notes',
        title: 'Launch decision',
        body: 'secret-summary-body',
        now: new Date('2026-11-17T10:00:00.000Z'),
      });
      expect(String(params.user._id)).toBe(String(user._id));
      expect(params.auditContext.endpoint).toContain(CHANNEL.channelId);

      expect(await storedAnswer(row)).toEqual({
        kind: 'page-created',
        pageUrl: `${SITE_URL}/0123456789abcdef01234567`,
        range: {
          messageCount: 2,
          firstPostedAt: '2026-11-16T09:00:00.000Z',
          lastPostedAt: '2026-11-16T09:05:00.000Z',
        },
        truncated: false,
      });
      expect(await stateOf(row)).toBe('done');
    });

    it('says when only part of the conversation could be read', async () => {
      const { row } = await acceptedRequest();
      const h = harness();
      summaryRequested(h);
      h.fetchConversation.mockResolvedValue(conversationOk(CONVERSATION, true));

      await createAgentRequestRunner(h.deps)(row);

      expect(await storedAnswer(row)).toMatchObject({
        kind: 'page-created',
        truncated: true,
      });
    });

    it.each([
      ['path-conflict'],
      ['forbidden'],
    ] as const)('passes on %s when the page cannot be created (Requirement 5.11)', async (reason) => {
      const { row } = await acceptedRequest();
      const h = harness();
      summaryRequested(h);
      h.createSummaryPage.mockResolvedValue({ kind: 'failed', reason });

      await createAgentRequestRunner(h.deps)(row);

      expect(await storedAnswer(row)).toEqual({ kind: 'failed', reason });
      expect(await stateOf(row)).toBe('done');
    });
  });

  describe('a conversation the proxy could not hand over (Requirement 5.17)', () => {
    it.each([
      [{ reason: 'not-in-channel', remedy: 'Invite the bot to the channel.' }],
      [{ reason: 'rate-limited', remedy: null }],
      [{ reason: 'unsupported', remedy: null }],
      [{ reason: 'unknown-request', remedy: null }],
    ] as const)('passes on the failure the proxy reported: %o', async (failure) => {
      const { row } = await acceptedRequest();
      const h = harness();
      summaryRequested(h);
      h.fetchConversation.mockResolvedValue({
        ok: true,
        response: { ok: false, failure },
      });

      await createAgentRequestRunner(h.deps)(row);

      expect(await storedAnswer(row)).toEqual({
        kind: 'failed',
        reason: 'conversation-unavailable',
        conversationFailure: failure,
      });
      expect(h.gateway.summarize).not.toHaveBeenCalled();
      expect(h.createSummaryPage).not.toHaveBeenCalled();
      expect(await stateOf(row)).toBe('done');
    });

    it.each([
      ['unreachable'],
      ['http-error'],
      ['malformed-response'],
      ['rejected'],
    ] as const)('asks to try again later when the call ended as %s', async (reason) => {
      const { row } = await acceptedRequest();
      const h = harness();
      summaryRequested(h);
      h.fetchConversation.mockResolvedValue({ ok: false, reason });

      await createAgentRequestRunner(h.deps)(row);

      // No conversationFailure: the proxy words this as "could not read the
      // conversation, try again later" without blaming the chat service.
      expect(await storedAnswer(row)).toEqual({
        kind: 'failed',
        reason: 'conversation-unavailable',
      });
      expect(h.createSummaryPage).not.toHaveBeenCalled();
      expect(await stateOf(row)).toBe('done');
    });

    it('does not summarize a conversation with no messages, whatever the proxy counted', async () => {
      const { row } = await acceptedRequest();
      const h = harness();
      summaryRequested(h);
      h.fetchConversation.mockResolvedValue(conversationOk([]));

      await createAgentRequestRunner(h.deps)(row);

      expect(await storedAnswer(row)).toEqual({
        kind: 'failed',
        reason: 'conversation-unavailable',
        conversationFailure: { reason: 'empty', remedy: null },
      });
      expect(h.gateway.summarize).not.toHaveBeenCalled();
    });
  });

  describe('the five-minute limit (Requirement 15.10)', () => {
    it('stops a run that outlives the limit and answers timeout', async () => {
      const { row } = await acceptedRequest();
      const h = harness({ timeoutMs: 50 });
      h.gateway.answer.mockImplementation(async (_request, { signal }) => {
        await untilAborted(signal);
        return ABORTED;
      });

      await createAgentRequestRunner(h.deps)(row);

      expect(await storedAnswer(row)).toEqual({
        kind: 'failed',
        reason: 'timeout',
      });
      expect(await stateOf(row)).toBe('done');
    });

    it('answers timeout when GROWI AI reports the run as aborted', async () => {
      const { row } = await acceptedRequest();
      const h = harness();
      h.gateway.classify.mockResolvedValue(ABORTED);

      await createAgentRequestRunner(h.deps)(row);

      expect(await storedAnswer(row)).toEqual({
        kind: 'failed',
        reason: 'timeout',
      });
      expect(h.gateway.answer).not.toHaveBeenCalled();
    });

    it('answers timeout when the deadline passed while the conversation was being read', async () => {
      const { row } = await acceptedRequest();
      const h = harness({ timeoutMs: 30 });
      summaryRequested(h);
      h.fetchConversation.mockImplementation(async () => {
        await sleep(150);
        return conversationOk(CONVERSATION);
      });

      await createAgentRequestRunner(h.deps)(row);

      expect(await storedAnswer(row)).toEqual({
        kind: 'failed',
        reason: 'timeout',
      });
      expect(h.gateway.summarize).not.toHaveBeenCalled();
      expect(h.createSummaryPage).not.toHaveBeenCalled();
    });

    // A page that exists is always linked: answering timeout would leave the
    // person a page they cannot find, and a retry would hit path-conflict.
    it('still links a page whose creation finished after the deadline', async () => {
      const { row } = await acceptedRequest();
      const h = harness({ timeoutMs: 30 });
      summaryRequested(h);
      h.createSummaryPage.mockImplementation(async () => {
        await sleep(150);
        return {
          kind: 'created',
          pageId: '0123456789abcdef01234567',
          path: '/x',
        };
      });

      await createAgentRequestRunner(h.deps)(row);

      expect(await storedAnswer(row)).toMatchObject({
        kind: 'page-created',
        pageUrl: `${SITE_URL}/0123456789abcdef01234567`,
      });
      expect(await stateOf(row)).toBe('done');
    });

    it('passes on path-conflict when the deadline passed while the page creation was refused', async () => {
      const { row } = await acceptedRequest();
      const h = harness({ timeoutMs: 30 });
      summaryRequested(h);
      h.createSummaryPage.mockImplementation(async () => {
        await sleep(150);
        return { kind: 'failed', reason: 'path-conflict' };
      });

      await createAgentRequestRunner(h.deps)(row);

      expect(await storedAnswer(row)).toEqual({
        kind: 'failed',
        reason: 'path-conflict',
      });
    });

    it('answers timeout, not agent-error, when GROWI AI throws after the deadline', async () => {
      const { row } = await acceptedRequest();
      const h = harness({ timeoutMs: 30 });
      h.gateway.classify.mockImplementation(async (_text, { signal }) => {
        await untilAborted(signal);
        throw new Error('output was not an object');
      });

      await createAgentRequestRunner(h.deps)(row);

      expect(await storedAnswer(row)).toEqual({
        kind: 'failed',
        reason: 'timeout',
      });
    });
  });

  describe('failures that produce a failed answer (Requirement 15.10)', () => {
    it('answers agent-error when GROWI AI throws', async () => {
      const { row } = await acceptedRequest();
      const h = harness();
      h.gateway.answer.mockRejectedValue(new Error('model is down'));

      await createAgentRequestRunner(h.deps)(row);

      expect(await storedAnswer(row)).toEqual({
        kind: 'failed',
        reason: 'agent-error',
      });
      expect(await stateOf(row)).toBe('done');
    });

    // The protocol has no failure code for "AI unavailable"; agent-error is
    // the one the proxy words as "an error occurred, try again later".
    it('answers agent-error without asking GROWI AI when AI was turned off after acceptance (Requirement 15.4)', async () => {
      const { row } = await acceptedRequest();
      const h = harness();
      h.isAiReady.mockReturnValue(false);

      await createAgentRequestRunner(h.deps)(row);

      expect(await storedAnswer(row)).toEqual({
        kind: 'failed',
        reason: 'agent-error',
      });
      expect(h.gateway.classify).not.toHaveBeenCalled();
      expect(await stateOf(row)).toBe('done');
    });

    it.each([
      [
        'suspended',
        async (user: { _id: mongoose.Types.ObjectId }) => {
          await getUserModel().updateOne(
            { _id: user._id },
            { status: UserStatus.STATUS_SUSPENDED },
          );
        },
      ],
      [
        'made read-only',
        async (user: { _id: mongoose.Types.ObjectId }) => {
          await getUserModel().updateOne({ _id: user._id }, { readOnly: true });
        },
      ],
      [
        'unlinked',
        async () => {
          await ChatAccountLink.deleteMany({});
        },
      ],
    ])('answers agent-error without asking GROWI AI when the user was %s after acceptance', async (_label, change) => {
      const { row, user } = await acceptedRequest();
      const h = harness();
      await change(user);

      await createAgentRequestRunner(h.deps)(row);

      expect(await storedAnswer(row)).toEqual({
        kind: 'failed',
        reason: 'agent-error',
      });
      expect(h.gateway.classify).not.toHaveBeenCalled();
      expect(await stateOf(row)).toBe('done');
    });

    it('does not run as another GROWI user when the chat account was linked to someone else after acceptance', async () => {
      const { row, actor } = await acceptedRequest();
      const other = await createUser();
      await ChatAccountLink.deleteMany({});
      await link(actor, other._id);
      const h = harness();

      await createAgentRequestRunner(h.deps)(row);

      expect(await storedAnswer(row)).toEqual({
        kind: 'failed',
        reason: 'agent-error',
      });
      expect(h.gateway.classify).not.toHaveBeenCalled();
    });
  });

  describe('storing the answer, then finishing the row (design.md 依頼の行の状態)', () => {
    it('finishes the row without a second answer when one is already stored', async () => {
      const { row } = await acceptedRequest();
      const earlier: AgentAnswer = { kind: 'failed', reason: 'timeout' };
      await ChatOutboxRow.create({
        kind: 'command-answer',
        relationId: row.relationId,
        requestId: row.requestId,
        answer: earlier,
        state: 'pending',
      });
      const h = harness();

      await createAgentRequestRunner(h.deps)(row);

      expect(await storedAnswer(row)).toEqual(earlier);
      expect(await stateOf(row)).toBe('done');
    });

    it('leaves the row running when the answer could not be stored', async () => {
      const { row } = await acceptedRequest();
      const outbox = mock<ChatOutbox>({
        enqueue: vi.fn(() => Promise.reject(new Error('connection closed'))),
      });
      const h = harness({ outbox });

      await expect(createAgentRequestRunner(h.deps)(row)).resolves.toBe(
        undefined,
      );

      expect(await stateOf(row)).toBe('running');
    });

    it('stores the answer while the row is still running', async () => {
      const { row } = await acceptedRequest();
      const statesAtEnqueue: unknown[] = [];
      const real = createChatOutbox({ dispatcher: noopDispatcher });
      const outbox = mock<ChatOutbox>({
        enqueue: vi.fn(async (entry) => {
          statesAtEnqueue.push(await stateOf(row));
          await real.enqueue(entry);
        }),
      });
      const h = harness({ outbox });

      await createAgentRequestRunner(h.deps)(row);

      expect(statesAtEnqueue).toEqual(['running']);
      expect(await stateOf(row)).toBe('done');
    });

    it('never rejects, even when finishing the row fails', async () => {
      const { row } = await acceptedRequest();
      const requests = mock<AgentRunnerDeps['requests']>({
        updateOne: vi.fn(() => {
          throw new Error('connection closed');
        }),
      });
      const h = harness({ requests });

      await expect(createAgentRequestRunner(h.deps)(row)).resolves.toBe(
        undefined,
      );
      expect((await storedAnswer(row)).kind).toBe('text');
    });
  });

  describe('logging', () => {
    it('logs ids but never the request text, the conversation, or what GROWI AI wrote', async () => {
      const question = await acceptedRequest();
      const summary = await acceptedRequest({ text: 'secret-summary-request' });
      const failing = await acceptedRequest();
      const h = harness();
      h.gateway.answer.mockResolvedValue(
        completed({ markdown: 'secret-answer-markdown', sources: [] }),
      );
      await createAgentRequestRunner(h.deps)(question.row);
      summaryRequested(h);
      await createAgentRequestRunner(h.deps)(summary.row);
      h.gateway.classify.mockRejectedValue(
        new Error('provider said: secret-question-text was rejected'),
      );
      await createAgentRequestRunner(h.deps)(failing.row);

      const text = JSON.stringify(logged, (_key, value: unknown) =>
        value instanceof Error
          ? { name: value.name, message: value.message, stack: value.stack }
          : value,
      );
      expect(text).toContain(failing.row.requestId);
      for (const secret of [
        'secret-question-text',
        'secret-summary-request',
        'secret-message-one',
        'secret-message-two',
        'secret-summary-body',
        'secret-answer-markdown',
      ]) {
        expect(text).not.toContain(secret);
      }
    });
  });
});
