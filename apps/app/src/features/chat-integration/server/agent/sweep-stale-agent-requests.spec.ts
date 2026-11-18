// The stale-row sweep (design.md RunAgentRequest): a request whose run
// stopped is answered `failed/timeout` and finished, and a run and the sweep
// finishing the same request leave exactly one answer. The request rows and
// the answer rows are real, with the indexes the migrations create.

import {
  type AgentAnswer,
  type ChannelRef,
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

import type { WriteActor } from '../command/perform-write-command';
import type { ChatOutbox } from '../outbox';
import { createChatOutbox } from '../outbox/chat-outbox';
import { outboxDispatcher } from '../outbox/deliverers';
import { ChatOutboxRow } from '../outbox/models/chat-outbox';
import { OutboxDispatchCronService } from '../outbox/outbox-dispatch-cron';
import type { OutboxDispatcher } from '../outbox/outbox-dispatcher';
import type { GrowiAiGateway } from './growi-ai-gateway-types';
import {
  ChatAgentRequest,
  type ChatAgentRequestDocument,
  type ChatAgentRequestState,
} from './models/chat-agent-request';
import {
  type AgentRunnerDeps,
  createAgentRequestRunner,
} from './run-agent-request';
import {
  createStaleAgentRequestSweep,
  type StaleAgentRequestSweepDeps,
  type SweepLogger,
} from './sweep-stale-agent-requests';

const RELATION_ID = 'relation-sweep';
const MINUTE = 60 * 1000;
const NOW = new Date('2026-11-17T10:00:00.000Z');
const CHANNEL: ChannelRef = {
  platform: 'slack',
  channelId: toNativeChannelId('C0SWEEP'),
  channelName: 'sweep-channel',
  isPrivate: false,
};
const TIMEOUT_ANSWER: AgentAnswer = { kind: 'failed', reason: 'timeout' };
const RUN_ANSWER_TEXT = 'The run finished after all.';

let seq = 0;

const requestRow = (options: {
  startedMinutesAgo: number;
  state?: ChatAgentRequestState;
  text?: string;
}): Promise<ChatAgentRequestDocument> => {
  seq += 1;
  return ChatAgentRequest.create({
    relationId: RELATION_ID,
    requestId: `req-sweep-${seq}`,
    userId: new mongoose.Types.ObjectId(),
    state: options.state ?? 'running',
    text: options.text ?? 'what did we decide?',
    conversationKey: `slack:${CHANNEL.channelId}:1700000000.${seq}`,
    actor: {
      platform: 'slack',
      accountId: `U0SWEEP-${seq}`,
      displayName: 'Asker',
    },
    channel: CHANNEL,
    auditContext: { requestArrivedAt: NOW },
    startedAt: new Date(NOW.getTime() - options.startedMinutesAgo * MINUTE),
  });
};

const answersOf = (row: ChatAgentRequestDocument) =>
  ChatOutboxRow.find({
    kind: 'command-answer',
    relationId: row.relationId,
    requestId: row.requestId,
  }).lean();

/** The single answer stored for the row; also proves the proxy would accept it. */
const singleAnswerOf = async (
  row: ChatAgentRequestDocument,
): Promise<AgentAnswer> => {
  const rows = await answersOf(row);
  expect(rows).toHaveLength(1);
  const { answer } = rows[0];
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

const noopDispatcher = mock<OutboxDispatcher>({
  requestDrain: vi.fn(async () => {}),
});

const storingOutbox = (): ChatOutbox =>
  createChatOutbox({ dispatcher: noopDispatcher });

const recordingLogger = () => {
  const records: unknown[][] = [];
  const logger: SweepLogger = {
    info: (...args) => {
      records.push(args);
    },
    error: (...args) => {
      records.push(args);
    },
  };
  return { logger, records };
};

const sweepWith = (overrides: Partial<StaleAgentRequestSweepDeps> = {}) =>
  createStaleAgentRequestSweep({
    requests: ChatAgentRequest,
    outbox: storingOutbox(),
    logger: recordingLogger().logger,
    ...overrides,
  });

/** An outbox whose `enqueue` rejects for the given requests only. */
const outboxFailingFor = (
  failing: (requestId: string) => boolean,
): ChatOutbox => {
  const real = storingOutbox();
  return mock<ChatOutbox>({
    enqueue: vi.fn(async (entry) => {
      if (entry.kind === 'command-answer' && failing(entry.requestId)) {
        throw new Error('connection 7 to mongo:27017 closed');
      }
      await real.enqueue(entry);
    }),
  });
};

interface Gate {
  readonly opened: Promise<void>;
  open(): void;
}

const gate = (): Gate => {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
};

/** A run whose GROWI AI answers at once, as the row's (still linked) user. */
const runnerDeps = (
  row: ChatAgentRequestDocument,
  overrides: Partial<AgentRunnerDeps>,
): AgentRunnerDeps => {
  const gateway = mock<GrowiAiGateway>();
  gateway.classify.mockResolvedValue({
    kind: 'completed',
    value: { intent: 'answer' },
  });
  gateway.answer.mockResolvedValue({
    kind: 'completed',
    value: { markdown: RUN_ANSWER_TEXT, sources: [] },
  });
  return {
    gateway,
    fetchConversation: vi.fn(),
    outbox: storingOutbox(),
    requests: ChatAgentRequest,
    resolveActor: async () => ({
      user: mock<WriteActor>({ _id: row.userId }),
      userGroups: [],
      writeDenied: null,
    }),
    isAiReady: () => true,
    createSummaryPage: vi.fn(),
    siteUrl: () => 'https://wiki.example.test',
    now: () => NOW,
    ...overrides,
  };
};

describe('sweepStaleAgentRequests', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_sweep_stale_agent_requests',
    ));
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await Promise.all([
      ChatAgentRequest.deleteMany({}),
      ChatOutboxRow.deleteMany({}),
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

  describe('a request whose run stopped (Requirements 15.6, 15.10)', () => {
    it('answers timeout and finishes a row left running for more than 7 minutes', async () => {
      const row = await requestRow({ startedMinutesAgo: 8 });

      await sweepWith()(NOW);

      expect(await singleAnswerOf(row)).toEqual(TIMEOUT_ANSWER);
      expect(await stateOf(row)).toBe('done');
    });

    it('leaves a row started 6 minutes ago to its run', async () => {
      const row = await requestRow({ startedMinutesAgo: 6 });

      await sweepWith()(NOW);

      expect(await answersOf(row)).toHaveLength(0);
      expect(await stateOf(row)).toBe('running');
    });

    it('leaves a finished row alone, however old', async () => {
      const row = await requestRow({ startedMinutesAgo: 60, state: 'done' });

      await sweepWith()(NOW);

      expect(await answersOf(row)).toHaveLength(0);
      expect(await stateOf(row)).toBe('done');
    });

    it('only finishes the row when its answer is already stored', async () => {
      const row = await requestRow({ startedMinutesAgo: 8 });
      const earlier: AgentAnswer = {
        kind: 'text',
        markdown: 'stored by the run',
        sources: [],
      };
      await storingOutbox().enqueue({
        kind: 'command-answer',
        relationId: row.relationId,
        requestId: row.requestId,
        answer: earlier,
      });

      await sweepWith()(NOW);

      expect(await singleAnswerOf(row)).toEqual(earlier);
      expect(await stateOf(row)).toBe('done');
    });
  });

  describe('failures', () => {
    it('leaves the row running when its answer could not be stored, and answers it on the next sweep', async () => {
      const row = await requestRow({ startedMinutesAgo: 8 });
      let storeFails = true;
      const sweep = sweepWith({ outbox: outboxFailingFor(() => storeFails) });

      await sweep(NOW);

      expect(await answersOf(row)).toHaveLength(0);
      expect(await stateOf(row)).toBe('running');

      storeFails = false;
      await sweep(new Date(NOW.getTime() + 5 * MINUTE));

      expect(await singleAnswerOf(row)).toEqual(TIMEOUT_ANSWER);
      expect(await stateOf(row)).toBe('done');
    });

    it('goes on with the other rows when one row cannot be answered', async () => {
      const oldest = await requestRow({ startedMinutesAgo: 10 });
      const failing = await requestRow({ startedMinutesAgo: 9 });
      const newest = await requestRow({ startedMinutesAgo: 8 });
      const sweep = sweepWith({
        outbox: outboxFailingFor((id) => id === failing.requestId),
      });

      await expect(sweep(NOW)).resolves.toBeUndefined();

      expect(await singleAnswerOf(oldest)).toEqual(TIMEOUT_ANSWER);
      expect(await stateOf(oldest)).toBe('done');
      expect(await answersOf(failing)).toHaveLength(0);
      expect(await stateOf(failing)).toBe('running');
      expect(await singleAnswerOf(newest)).toEqual(TIMEOUT_ANSWER);
      expect(await stateOf(newest)).toBe('done');
    });

    it('closes a row whose finishing failed on the next sweep, without a second answer', async () => {
      const row = await requestRow({ startedMinutesAgo: 8 });
      const sweep = sweepWith();
      const finishing = vi
        .spyOn(ChatAgentRequest, 'updateOne')
        .mockImplementationOnce(() => {
          throw new Error('connection 7 to mongo:27017 closed');
        });
      try {
        await sweep(NOW);
      } finally {
        finishing.mockRestore();
      }
      expect(await stateOf(row)).toBe('running');

      await sweep(new Date(NOW.getTime() + 5 * MINUTE));

      expect(await singleAnswerOf(row)).toEqual(TIMEOUT_ANSWER);
      expect(await stateOf(row)).toBe('done');
    });

    it('never rejects, even when the rows cannot be read', async () => {
      const { logger, records } = recordingLogger();
      const requests = mock<StaleAgentRequestSweepDeps['requests']>({
        find: vi.fn(() => {
          throw new Error('connection 7 to mongo:27017 closed');
        }),
      });

      await expect(
        sweepWith({ requests, logger })(NOW),
      ).resolves.toBeUndefined();
      expect(records).not.toHaveLength(0);
    });
  });

  describe('bounded work per call', () => {
    it('answers the 50 oldest stale rows per call and the rest on the next call', async () => {
      const rows = await Promise.all(
        Array.from({ length: 51 }, (_, i) =>
          requestRow({ startedMinutesAgo: 8 + i }),
        ),
      );
      const newest = rows[0];
      const sweep = sweepWith();

      await sweep(NOW);

      expect(await ChatAgentRequest.countDocuments({ state: 'done' })).toBe(50);
      expect(await stateOf(newest)).toBe('running');

      await sweep(NOW);

      expect(await stateOf(newest)).toBe('done');
      expect(
        await ChatOutboxRow.countDocuments({ kind: 'command-answer' }),
      ).toBe(51);
    });

    it('tries each stale row once per call, even when every answer fails to store', async () => {
      await requestRow({ startedMinutesAgo: 8 });
      await requestRow({ startedMinutesAgo: 9 });
      await requestRow({ startedMinutesAgo: 10 });
      const outbox = outboxFailingFor(() => true);

      await sweepWith({ outbox })(NOW);

      expect(outbox.enqueue).toHaveBeenCalledTimes(3);
    });
  });

  describe('logging', () => {
    it('logs the ids and the error name, never the request text or an error message', async () => {
      const row = await requestRow({
        startedMinutesAgo: 8,
        text: 'secret-request-text',
      });
      const { logger, records } = recordingLogger();
      const outbox = mock<ChatOutbox>({
        enqueue: vi.fn(() =>
          Promise.reject(
            new Error('secret-error-message about secret-request-text'),
          ),
        ),
      });

      await sweepWith({ outbox, logger })(NOW);

      const text = JSON.stringify(records, (_key, value: unknown) =>
        value instanceof Error
          ? { name: value.name, message: value.message, stack: value.stack }
          : value,
      );
      expect(text).toContain(row.requestId);
      expect(text).toContain('"Error"');
      expect(text).not.toContain('secret-request-text');
      expect(text).not.toContain('secret-error-message');
    });
  });

  describe('a run and the sweep finishing the same request (design.md 依頼の行の状態)', () => {
    it('keeps the sweep’s answer when the sweep stores first; the run only finishes the row', async () => {
      const row = await requestRow({ startedMinutesAgo: 8 });
      const reached = gate();
      const release = gate();
      const real = storingOutbox();
      const runnerOutbox = mock<ChatOutbox>({
        enqueue: vi.fn(async (entry) => {
          reached.open();
          await release.opened;
          await real.enqueue(entry);
        }),
      });
      const run = createAgentRequestRunner(
        runnerDeps(row, { outbox: runnerOutbox }),
      )(row);
      await reached.opened;

      await sweepWith()(NOW);
      release.open();
      await run;

      expect(await singleAnswerOf(row)).toEqual(TIMEOUT_ANSWER);
      expect(await stateOf(row)).toBe('done');
    });

    it('keeps the run’s answer when the run stores first; the sweep only finishes the row', async () => {
      const row = await requestRow({ startedMinutesAgo: 8 });
      const reached = gate();
      const release = gate();
      const real = storingOutbox();
      // Held after its answer is stored, before it finishes the row.
      const runnerOutbox = mock<ChatOutbox>({
        enqueue: vi.fn(async (entry) => {
          await real.enqueue(entry);
          reached.open();
          await release.opened;
        }),
      });
      const run = createAgentRequestRunner(
        runnerDeps(row, { outbox: runnerOutbox }),
      )(row);
      await reached.opened;

      await sweepWith()(NOW);
      expect(await stateOf(row)).toBe('done');
      release.open();
      await run;

      expect(await singleAnswerOf(row)).toMatchObject({
        kind: 'text',
        markdown: RUN_ANSWER_TEXT,
      });
      expect(await stateOf(row)).toBe('done');
    });

    it('leaves exactly one answer when both store at the same moment', async () => {
      const row = await requestRow({ startedMinutesAgo: 8 });
      const bothArrived = gate();
      let arrivals = 0;
      const real = storingOutbox();
      const meetingOutbox = (): ChatOutbox =>
        mock<ChatOutbox>({
          enqueue: vi.fn(async (entry) => {
            arrivals += 1;
            if (arrivals === 2) bothArrived.open();
            await bothArrived.opened;
            await real.enqueue(entry);
          }),
        });

      await Promise.all([
        createAgentRequestRunner(runnerDeps(row, { outbox: meetingOutbox() }))(
          row,
        ),
        sweepWith({ outbox: meetingOutbox() })(NOW),
      ]);

      expect(await answersOf(row)).toHaveLength(1);
      expect(await stateOf(row)).toBe('done');
    });
  });

  describe('in production, from the 5-minute outbox cron', () => {
    it('is run by each tick of the cron', async () => {
      const row = await requestRow({ startedMinutesAgo: 8 });
      const cron = new OutboxDispatchCronService({
        dispatcher: noopDispatcher,
        presence: {
          hasAnyIntegration: vi.fn(async () => true),
          markPresent: vi.fn(),
        },
        clock: () => NOW,
      });

      await cron.executeJob();
      // The stored answer started a real drain; let it settle before cleanup.
      await outboxDispatcher.requestDrain();

      expect(await answersOf(row)).toHaveLength(1);
      expect(await stateOf(row)).toBe('done');
    });
  });
});
