import type { AgentAnswer } from '@growi/chat';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import { ChatOutboxRow } from './models/chat-outbox';
import { outboxDispatchCronService } from './outbox-dispatch-cron';
import type {
  Deliverer,
  DelivererTable,
  DrainSummary,
  OutboxDispatcherDeps,
} from './outbox-dispatcher';
import {
  CLAIM_STALE_AFTER_MS,
  createOutboxDispatcher,
} from './outbox-dispatcher';

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

  // The real check is the type checker: each `@ts-expect-error` below fails
  // `lint:typecheck` as unused once a table may leave a kind out.
  it('does not accept a deliverer table that leaves a kind out', () => {
    const notification = sendingDeliverer();

    // @ts-expect-error -- no deliverer for 'command-answer'
    const table: DelivererTable = { notification };
    // @ts-expect-error -- no deliverer for 'command-answer'
    const deps: OutboxDispatcherDeps = { deliverers: { notification } };

    expect(Object.keys(table)).toEqual(['notification']);
    expect(Object.keys(deps.deliverers)).toEqual(['notification']);
  });

  it('writes the result a deliverer reports onto the row', async () => {
    await seedNotificationRow();
    const result = { outcomes: [] };
    const deliverer = vi
      .fn<Deliverer>()
      .mockResolvedValue({ outcome: 'sent', result });

    await createOutboxDispatcher({
      deliverers: { notification: deliverer, 'command-answer': deliverer },
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

const seedBacklog = (count: number, nextAttemptAt: Date) =>
  ChatOutboxRow.insertMany(
    Array.from({ length: count }, (_, i) => ({
      kind: 'notification',
      requestId: `req-${i}`,
      relationId: 'rel-1',
      targets: [{ platform: 'slack', channelId: 'C1' }],
      markdown: `notification ${i}`,
      containsRestrictedPage: false,
      nextAttemptAt,
    })),
  );

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
        deliverers: {
          notification: otherProcessDeliverer,
          'command-answer': otherProcessDeliverer,
        },
      }).drain(new Date(current + 1000));
      return { outcome: 'sent' };
    });

    await createOutboxDispatcher({
      deliverers: { notification: deliverer, 'command-answer': deliverer },
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

  it.each<[string, Awaited<ReturnType<Deliverer>>]>([
    ['a retry', { outcome: 'retry', result: { by: 'stalled' } }],
    ['a sent', { outcome: 'sent', result: { by: 'stalled' } }],
  ])('keeps the result of the process that took a stale row back when the stalled process later reports %s', async (_label, lateVerdict) => {
    await seedPendingNotification('req-taken-back');
    const otherProcessDeliverer = vi
      .fn<Deliverer>()
      .mockResolvedValue({ outcome: 'sent', result: { by: 'other' } });
    const stalledDeliverer = vi.fn<Deliverer>(async () => {
      await createOutboxDispatcher({
        deliverers: {
          notification: otherProcessDeliverer,
          'command-answer': otherProcessDeliverer,
        },
      }).drain(new Date(T + CLAIM_STALE_AFTER_MS + 1000));
      return lateVerdict;
    });

    await createOutboxDispatcher({
      deliverers: {
        notification: stalledDeliverer,
        'command-answer': stalledDeliverer,
      },
      clock: () => new Date(T),
    }).drain(new Date(T));

    expect(otherProcessDeliverer).toHaveBeenCalledTimes(1);
    expect(
      await ChatOutboxRow.collection.findOne({ requestId: 'req-taken-back' }),
    ).toMatchObject({
      state: 'sent',
      attempts: 0,
      result: { by: 'other' },
    });
  });

  it('drops the stalled process’s retry while the process that took the row back is still sending, then keeps that process’s sent', async () => {
    await seedPendingNotification('req-taken-back');
    const otherStarted = createLatch();
    const releaseOther = createLatch();
    const otherProcessDeliverer = vi.fn<Deliverer>(async () => {
      otherStarted.release();
      await releaseOther.promise;
      return { outcome: 'sent', result: { by: 'other' } };
    });
    let otherProcessDrain: Promise<DrainSummary> | undefined;
    const stalledDeliverer = vi.fn<Deliverer>(async () => {
      otherProcessDrain = createOutboxDispatcher({
        deliverers: {
          notification: otherProcessDeliverer,
          'command-answer': otherProcessDeliverer,
        },
      }).drain(new Date(T + CLAIM_STALE_AFTER_MS + 1000));
      await otherStarted.promise;
      return { outcome: 'retry', result: { by: 'stalled' } };
    });

    await createOutboxDispatcher({
      deliverers: {
        notification: stalledDeliverer,
        'command-answer': stalledDeliverer,
      },
      clock: () => new Date(T),
    }).drain(new Date(T));

    // The stalled process has settled; the row is still the other's claim.
    expect(
      await ChatOutboxRow.collection.findOne({ requestId: 'req-taken-back' }),
    ).toMatchObject({ state: 'claimed', attempts: 0 });

    releaseOther.release();
    await otherProcessDrain;

    expect(
      await ChatOutboxRow.collection.findOne({ requestId: 'req-taken-back' }),
    ).toMatchObject({
      state: 'sent',
      attempts: 0,
      result: { by: 'other' },
    });
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
          deliverers: { notification: deliverer, 'command-answer': deliverer },
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
    // That two drains never overlap is coalescing-runner.spec's concern.
    it('sends rows written while a drain is running without waiting for the cron', async () => {
      const firstStarted = createLatch();
      const releaseFirst = createLatch();
      const sent: string[] = [];
      const deliverer = vi.fn<Deliverer>(async (row) => {
        if (row.requestId === 'req-1') {
          firstStarted.release();
          await releaseFirst.promise;
        }
        sent.push(row.requestId);
        return { outcome: 'sent' };
      });
      const dispatcher = createOutboxDispatcher({
        deliverers: { notification: deliverer, 'command-answer': deliverer },
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
      expect(await ChatOutboxRow.find({}).distinct('state')).toEqual(['sent']);
    });

    it('resolves rather than rejects when the drain fails', async () => {
      await seedPendingNotification('req-1', { nextAttemptAt: new Date() });
      const deliverer = vi
        .fn<Deliverer>()
        .mockRejectedValue(new Error('proxy exploded'));
      const dispatcher = createOutboxDispatcher({
        deliverers: { notification: deliverer, 'command-answer': deliverer },
      });

      await expect(dispatcher.requestDrain()).resolves.toBeUndefined();
    });

    // One drain handles at most 50 rows; the rest of a burst must not be
    // left for the 5-minute cron.
    it('sends a backlog larger than one drain’s batch in a single request', async () => {
      const rowCount = 51;
      await seedBacklog(rowCount, new Date());
      const deliverer = sendingDeliverer();

      await createOutboxDispatcher({
        deliverers: { notification: deliverer, 'command-answer': deliverer },
      }).requestDrain();

      expect(deliverer).toHaveBeenCalledTimes(rowCount);
      expect(await ChatOutboxRow.countDocuments({ state: 'sent' })).toBe(
        rowCount,
      );
    });

    // A retry due again at once (or soon) must not keep a full batch coming
    // back forever: one request tries each row once.
    it.each([
      0, 10,
    ])('finishes, trying each row once, when every row of a full backlog asks to be retried after %i ms', async (retryAfterMs) => {
      const rowCount = 60;
      await seedBacklog(rowCount, new Date());
      const deliverer = vi.fn<Deliverer>(() => {
        if (deliverer.mock.calls.length > 3 * rowCount) {
          // Ends a runaway loop so the failure is an assertion, not a hang.
          return Promise.reject(new Error('runaway drain'));
        }
        return Promise.resolve({ outcome: 'retry', retryAfterMs });
      });

      await createOutboxDispatcher({
        deliverers: { notification: deliverer, 'command-answer': deliverer },
      }).requestDrain();

      const attempted = deliverer.mock.calls.map(([row]) => row.requestId);
      expect(attempted).toHaveLength(rowCount);
      expect(new Set(attempted).size).toBe(rowCount);
    });

    it('leaves rows written during the run to the follow-up run their writer requests', async () => {
      // The run starts at T. The late row is due at T + 1 ms, strictly after
      // the start, and the clock has moved past it when it is written -- so
      // it is left only because it was not due when the run began, not
      // because it is not due yet.
      let current = T;
      await seedBacklog(1, new Date(T));
      const deliverer = vi.fn<Deliverer>(async (row) => {
        if (row.requestId === 'req-0') {
          current = T + MINUTE;
          // Written, but nobody asks for a drain for it.
          await seedPendingNotification('req-late', {
            nextAttemptAt: new Date(T + 1),
          });
        }
        return { outcome: 'sent' };
      });

      await createOutboxDispatcher({
        deliverers: { notification: deliverer, 'command-answer': deliverer },
        clock: () => new Date(current),
      }).requestDrain();

      expect(deliverer.mock.calls.map(([row]) => row.requestId)).toEqual([
        'req-0',
      ]);
      expect(
        (await ChatOutboxRow.findOne({ requestId: 'req-late' }))?.state,
      ).toBe('pending');
    });
  });

  it('tries each row at most once per drain even when its retry is due at the same instant', async () => {
    const rowCount = 3;
    await seedBacklog(rowCount, new Date(T - MINUTE));
    const deliverer = vi.fn<Deliverer>(() => {
      if (deliverer.mock.calls.length > 3 * rowCount) {
        return Promise.reject(new Error('runaway drain'));
      }
      return Promise.resolve({ outcome: 'retry', retryAfterMs: 0 });
    });

    // A frozen clock: every claim happens at T, so a retry due after 0 ms is
    // due at exactly the drain's own time.
    const summary = await createOutboxDispatcher({
      deliverers: { notification: deliverer, 'command-answer': deliverer },
      clock: () => new Date(T),
    }).drain(new Date(T));

    expect(summary).toEqual({ sent: 0, failed: rowCount, givenUp: 0 });
    expect(deliverer).toHaveBeenCalledTimes(rowCount);
  });
});
