import type { AgentAnswer, CommandAnswerResult } from '@growi/chat';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import type { sendCommandAnswer as sendCommandAnswerFn } from '../proxy-client';
import { createCommandAnswerDeliverer } from './command-answer-deliverer';
import { ChatOutboxRow } from './models/chat-outbox';
import type { Deliverer } from './outbox-dispatcher';
import {
  createOutboxDispatcher,
  NOTIFICATION_RETRY_CONFIG,
} from './outbox-dispatcher';

type SendResult = Awaited<ReturnType<typeof sendCommandAnswerFn>>;

const HOUR = 60 * 60 * 1000;
const T = new Date('2026-01-01T00:00:00.000Z').getTime();
const RELATION_ID = 'rel-answer';
const REQUEST_ID = 'req-agent-1';
const ANSWER: AgentAnswer = {
  kind: 'text',
  markdown: 'the answer',
  sources: [{ title: 'Page', url: 'https://growi.example.com/page' }],
};

const seedAnswerRow = () =>
  ChatOutboxRow.create({
    kind: 'command-answer',
    requestId: REQUEST_ID,
    relationId: RELATION_ID,
    answer: ANSWER,
    nextAttemptAt: new Date(T - 1000),
  });

/** The row as stored, read past Mongoose so a removed field is really absent. */
const storedRow = () =>
  ChatOutboxRow.collection.findOne({
    relationId: RELATION_ID,
    requestId: REQUEST_ID,
  });

const dispatcherSending = (send: typeof sendCommandAnswerFn) =>
  createOutboxDispatcher({
    deliverers: {
      notification: vi.fn<Deliverer<'notification'>>(),
      'command-answer': createCommandAnswerDeliverer({
        sendCommandAnswer: send,
      }),
    },
    clock: () => new Date(T),
  });

const answered = (status: CommandAnswerResult['status']): SendResult => ({
  ok: true,
  response: { status },
});

describe('createCommandAnswerDeliverer', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_command_answer_deliverer',
    ));
  });

  beforeEach(async () => {
    await ChatOutboxRow.deleteMany({});
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  it('sends the row’s answer for the row’s request to the row’s relation', async () => {
    await seedAnswerRow();
    const send = vi
      .fn<typeof sendCommandAnswerFn>()
      .mockResolvedValue(answered('delivered'));

    await dispatcherSending(send).drain(new Date(T));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(RELATION_ID, {
      requestId: REQUEST_ID,
      answer: ANSWER,
    });
  });

  describe('a final answer from the proxy finishes the row', () => {
    it.each([
      'delivered',
      'undeliverable',
      'unknown-request',
    ] as const)('%s: the row is sent, records the status, and no longer holds the answer', async (status) => {
      await seedAnswerRow();
      const send = vi
        .fn<typeof sendCommandAnswerFn>()
        .mockResolvedValue(answered(status));

      const summary = await dispatcherSending(send).drain(new Date(T));

      expect(summary).toEqual({ sent: 1, failed: 0, givenUp: 0 });
      const row = await storedRow();
      expect(row).toMatchObject({
        kind: 'command-answer',
        relationId: RELATION_ID,
        requestId: REQUEST_ID,
        state: 'sent',
        attempts: 0,
        result: { status },
      });
      expect(row).not.toHaveProperty('answer');
    });

    it('does not send a sent row again', async () => {
      await seedAnswerRow();
      const send = vi
        .fn<typeof sendCommandAnswerFn>()
        .mockResolvedValue(answered('delivered'));
      const dispatcher = dispatcherSending(send);

      await dispatcher.drain(new Date(T));
      await dispatcher.drain(new Date(T + 24 * HOUR));

      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  describe('anything else is retried later and counts toward giving up', () => {
    it.each<[string, SendResult, unknown]>([
      ['in-progress', answered('in-progress'), { status: 'in-progress' }],
      [
        'an HTTP failure',
        { ok: false, reason: 'http-error' },
        { failure: 'http-error' },
      ],
      [
        'the deadline (unreachable)',
        { ok: false, reason: 'unreachable' },
        { failure: 'unreachable' },
      ],
      [
        'a malformed response',
        { ok: false, reason: 'malformed-response' },
        { failure: 'malformed-response' },
      ],
    ])('%s: the row goes back to pending after a backoff, keeping the answer', async (_label, sendResult, recorded) => {
      await seedAnswerRow();
      const send = vi
        .fn<typeof sendCommandAnswerFn>()
        .mockResolvedValue(sendResult);

      const summary = await dispatcherSending(send).drain(new Date(T));

      expect(summary).toEqual({ sent: 0, failed: 1, givenUp: 0 });
      const row = await storedRow();
      expect(row).toMatchObject({
        state: 'pending',
        attempts: 1,
        result: recorded,
        answer: ANSWER,
      });
      expect(row?.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(
        T + NOTIFICATION_RETRY_CONFIG.baseBackoffMs,
      );
    });

    it.each<[string, SendResult, unknown]>([
      ['in-progress', answered('in-progress'), { status: 'in-progress' }],
      [
        'the deadline (unreachable)',
        { ok: false, reason: 'unreachable' },
        { failure: 'unreachable' },
      ],
    ])('%s every time: gives up on the 5th failure and leaves the reason on the row', async (_label, sendResult, recorded) => {
      await seedAnswerRow();
      const send = vi
        .fn<typeof sendCommandAnswerFn>()
        .mockResolvedValue(sendResult);
      const dispatcher = dispatcherSending(send);
      const drainAfterHours = (hours: number) =>
        dispatcher.drain(new Date(T + hours * HOUR));

      for (let round = 0; round < 4; round++) {
        // biome-ignore lint/performance/noAwaitInLoops: rounds run in order
        await drainAfterHours(round);
      }
      expect(await storedRow()).toMatchObject({
        state: 'pending',
        attempts: 4,
      });

      const summary = await drainAfterHours(4);

      expect(summary).toEqual({ sent: 0, failed: 0, givenUp: 1 });
      expect(await storedRow()).toMatchObject({
        state: 'given-up',
        attempts: NOTIFICATION_RETRY_CONFIG.maxAttempts,
        result: recorded,
        answer: ANSWER,
      });
      await drainAfterHours(5);
      expect(send).toHaveBeenCalledTimes(5);
    });

    it('a send that throws is retried like a failure instead of leaving the row claimed', async () => {
      await seedAnswerRow();
      const send = vi
        .fn<typeof sendCommandAnswerFn>()
        .mockRejectedValue(new Error('database went away'));

      const summary = await dispatcherSending(send).drain(new Date(T));

      expect(summary).toEqual({ sent: 0, failed: 1, givenUp: 0 });
      expect(await storedRow()).toMatchObject({
        state: 'pending',
        attempts: 1,
        claimedAt: null,
        answer: ANSWER,
      });
    });

    it('an answer row that lost its answer is not sent, and counts as a failure', async () => {
      // Written past the schema, which would refuse it.
      await ChatOutboxRow.collection.insertOne({
        kind: 'command-answer',
        requestId: REQUEST_ID,
        relationId: RELATION_ID,
        state: 'pending',
        attempts: 0,
        claimedAt: null,
        nextAttemptAt: new Date(T - 1000),
        result: null,
        createdAt: new Date(T - 1000),
      });
      const send = vi
        .fn<typeof sendCommandAnswerFn>()
        .mockResolvedValue(answered('delivered'));

      await dispatcherSending(send).drain(new Date(T));

      expect(send).not.toHaveBeenCalled();
      expect(await storedRow()).toMatchObject({
        state: 'pending',
        attempts: 1,
        result: { failure: 'missing-answer' },
      });
    });
  });
});
