import type { AgentAnswer } from '@growi/chat';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import { ChatOutboxRow } from './models/chat-outbox';
import { outboxDispatchCronService } from './outbox-dispatch-cron';
import type { Deliverer, DrainSummary } from './outbox-dispatcher';
import { createOutboxDispatcher } from './outbox-dispatcher';

const ANSWER: AgentAnswer = {
  kind: 'text',
  markdown: 'the answer',
  sources: [],
};

const seedNotificationRow = () =>
  ChatOutboxRow.create({
    kind: 'notification',
    requestId: 'req-notification',
    relationId: 'rel-1',
    targets: [{ platform: 'slack', channelId: 'C1' }],
    markdown: 'someone created /a',
    containsRestrictedPage: false,
  });

const seedAnswerRow = () =>
  ChatOutboxRow.create({
    kind: 'command-answer',
    requestId: 'req-answer',
    relationId: 'rel-1',
    answer: ANSWER,
  });

const sendingDeliverer = () =>
  vi.fn<Deliverer>().mockResolvedValue({ outcome: 'sent' });

describe('createOutboxDispatcher kind routing', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_outbox_dispatcher',
    ));
  });

  beforeEach(async () => {
    await ChatOutboxRow.deleteMany({});
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  it('sends each row through the deliverer registered for its kind', async () => {
    await seedNotificationRow();
    await seedAnswerRow();
    const notification = sendingDeliverer();
    const commandAnswer = sendingDeliverer();

    const summary = await createOutboxDispatcher({
      deliverers: { notification, 'command-answer': commandAnswer },
    }).drain(new Date());

    expect(summary).toEqual({ sent: 2, failed: 0, givenUp: 0 });
    expect(notification.mock.calls.map(([row]) => row.requestId)).toEqual([
      'req-notification',
    ]);
    expect(commandAnswer.mock.calls.map(([row]) => row.requestId)).toEqual([
      'req-answer',
    ]);
    const states = await ChatOutboxRow.find({}).distinct('state');
    expect(states).toEqual(['sent']);
  });

  // A row of a kind this process has no deliverer for is never claimed, so
  // a process that knows the kind can still send it.
  it('leaves a row whose kind has no deliverer pending and untouched, while still sending the rest', async () => {
    await seedNotificationRow();
    const answerRow = await seedAnswerRow();
    const before = await ChatOutboxRow.collection.findOne({
      _id: answerRow._id,
    });
    const notification = sendingDeliverer();

    const summary = await createOutboxDispatcher({
      deliverers: { notification },
    }).drain(new Date());

    expect(summary).toEqual({ sent: 1, failed: 0, givenUp: 0 });
    expect(notification).toHaveBeenCalledTimes(1);
    const after = await ChatOutboxRow.collection.findOne({
      _id: answerRow._id,
    });
    expect(after).toEqual(before);
    expect(after?.state).toBe('pending');
  });

  it('writes the result a deliverer reports onto the row', async () => {
    await seedNotificationRow();
    const result = { outcomes: [] };

    await createOutboxDispatcher({
      deliverers: {
        notification: vi
          .fn<Deliverer>()
          .mockResolvedValue({ outcome: 'sent', result }),
      },
    }).drain(new Date());

    const row = await ChatOutboxRow.findOne({});
    expect(row?.state).toBe('sent');
    expect(row?.result).toEqual(result);
  });
});

const MINUTE = 60 * 1000;
const T = new Date('2026-01-01T00:00:00.000Z').getTime();

const seedPendingNotification = (
  requestId: string,
  fields: { nextAttemptAt?: Date; state?: 'claimed'; claimedAt?: Date } = {},
) =>
  ChatOutboxRow.create({
    kind: 'notification',
    requestId,
    relationId: 'rel-1',
    targets: [{ platform: 'slack', channelId: 'C1' }],
    markdown: `notification ${requestId}`,
    containsRestrictedPage: false,
    nextAttemptAt: new Date(T - MINUTE),
    ...fields,
  });

interface Latch {
  readonly promise: Promise<void>;
  readonly release: () => void;
}

const createLatch = (): Latch => {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

describe('createOutboxDispatcher timing', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_outbox_dispatcher_timing',
    ));
  });

  beforeEach(async () => {
    await ChatOutboxRow.deleteMany({});
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  it('stamps each row with the time it was claimed, so a long drain does not let another process take its later rows', async () => {
    let current = T;
    await seedPendingNotification('req-first', {
      nextAttemptAt: new Date(T - 2 * MINUTE),
    });
    await seedPendingNotification('req-second');
    const otherProcessDeliverer = sendingDeliverer();
    let otherProcessSummary: DrainSummary | undefined;

    const deliverer = vi.fn<Deliverer>(async (row) => {
      if (row.requestId === 'req-first') {
        // The first send takes five minutes -- longer than a claim is honored.
        current += 5 * MINUTE;
        return { outcome: 'sent' };
      }
      // Another process drains while the second row is being sent.
      otherProcessSummary = await createOutboxDispatcher({
        deliverers: { notification: otherProcessDeliverer },
      }).drain(new Date(current + 1000));
      return { outcome: 'sent' };
    });

    await createOutboxDispatcher({
      deliverers: { notification: deliverer },
      clock: () => new Date(current),
    }).drain(new Date(T));

    expect(deliverer.mock.calls.map(([row]) => row.requestId)).toEqual([
      'req-first',
      'req-second',
    ]);
    expect(deliverer.mock.calls[1][0].claimedAt).toEqual(
      new Date(T + 5 * MINUTE),
    );
    expect(otherProcessDeliverer).not.toHaveBeenCalled();
    expect(otherProcessSummary).toEqual({ sent: 0, failed: 0, givenUp: 0 });
  });

  describe('Requirement 2.11: a send that stopped mid-way is taken back within 10 minutes', () => {
    const TICK_MS = 5 * MINUTE;

    it('ticks every 5 minutes', () => {
      expect(outboxDispatchCronService.getCronSchedule()).toBe('*/5 * * * *');
    });

    // Ticks fall at T, T+5, T+10, ... A claim made between two ticks is
    // stale once it is older than 4 minutes, and the first tick after that
    // takes it back: the worst case is a claim at T+1 (exactly 4 minutes
    // before the T+5 tick, so not yet stale there), taken back at T+10.
    // 4 (stale threshold) + 5 (one tick) = 9 minutes < 10.
    it('takes back a stalled send at most 9 minutes after it was claimed (4-minute stale threshold + one 5-minute tick)', async () => {
      const delays: number[] = [];

      for (const offset of [
        0,
        1,
        MINUTE - 1,
        MINUTE,
        MINUTE + 1,
        3 * MINUTE,
        TICK_MS - 1,
      ]) {
        // biome-ignore lint/performance/noAwaitInLoops: each case reuses the one row
        await ChatOutboxRow.deleteMany({});
        const claimedAt = T + offset;
        await seedPendingNotification('req-stalled', {
          state: 'claimed',
          claimedAt: new Date(claimedAt),
        });
        const deliverer = sendingDeliverer();
        // A frozen clock: each tick's drain runs at exactly the tick's time.
        const dispatcher = createOutboxDispatcher({
          deliverers: { notification: deliverer },
          clock: () => new Date(T),
        });

        let tick = T + TICK_MS;
        for (; tick <= T + 4 * TICK_MS; tick += TICK_MS) {
          // biome-ignore lint/performance/noAwaitInLoops: ticks must run in order
          await dispatcher.drain(new Date(tick));
          if (deliverer.mock.calls.length > 0) {
            break;
          }
        }
        delays.push(tick - claimedAt);
      }

      expect(Math.max(...delays)).toBe(9 * MINUTE);
      expect(Math.max(...delays)).toBeLessThan(10 * MINUTE);
    });
  });

  describe('requestDrain', () => {
    it('sends rows written one after another without any cron, never two deliveries at once', async () => {
      const firstStarted = createLatch();
      const releaseFirst = createLatch();
      const sent: string[] = [];
      let inFlight = 0;
      let maxInFlight = 0;
      const deliverer = vi.fn<Deliverer>(async (row) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (row.requestId === 'req-1') {
          firstStarted.release();
          await releaseFirst.promise;
        }
        inFlight -= 1;
        sent.push(row.requestId);
        return { outcome: 'sent' };
      });
      const dispatcher = createOutboxDispatcher({
        deliverers: { notification: deliverer },
      });

      await seedPendingNotification('req-1', { nextAttemptAt: new Date() });
      const first = dispatcher.requestDrain();
      await firstStarted.promise;
      await seedPendingNotification('req-2', { nextAttemptAt: new Date() });
      const second = dispatcher.requestDrain();
      await seedPendingNotification('req-3', { nextAttemptAt: new Date() });
      const third = dispatcher.requestDrain();
      releaseFirst.release();
      await Promise.all([first, second, third]);

      expect([...sent].sort()).toEqual(['req-1', 'req-2', 'req-3']);
      expect(maxInFlight).toBe(1);
      expect(await ChatOutboxRow.find({}).distinct('state')).toEqual(['sent']);
    });

    it('resolves rather than rejects when the drain fails', async () => {
      await seedPendingNotification('req-1', { nextAttemptAt: new Date() });
      const dispatcher = createOutboxDispatcher({
        deliverers: {
          notification: vi
            .fn<Deliverer>()
            .mockRejectedValue(new Error('proxy exploded')),
        },
      });

      await expect(dispatcher.requestDrain()).resolves.toBeUndefined();
    });
  });
});
