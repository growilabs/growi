// Proves task 8.2's contract (Requirements 2.4, 2.5, 2.6, 10.4, 10.7): the
// "送る" half of design.md's two-stage notification split.
//
// The one boundary that is faked here is the network call itself (`notify`,
// task 7.1, exercised on its own in `proxy-client.spec.ts`). The outbox rows
// are real MongoDB documents, because everything this task is responsible
// for -- claiming a row exclusively, remembering which targets already
// succeeded, backing off, and giving up -- IS the state of those rows.

import type { NotificationResult } from '@growi/chat';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import type { notify as notifyFn } from '../proxy-client';
import type { ChatNotificationOutboxTarget } from './models/chat-notification-outbox';
import { ChatNotificationOutbox } from './models/chat-notification-outbox';
import type { DrainSummary } from './notification-dispatcher';
import {
  CLAIM_STALE_AFTER_MS,
  createNotificationDispatcher,
  INVENTORY_NOT_READY_RETRY_INTERVAL_MS,
  NOTIFICATION_RETRY_CONFIG,
} from './notification-dispatcher';

const RELATION_ID = 'rel-1';
const TARGET_A: ChatNotificationOutboxTarget = {
  platform: 'slack',
  channelId: 'C-A',
};
const TARGET_B: ChatNotificationOutboxTarget = {
  platform: 'slack',
  channelId: 'C-B',
};

type NotifyParams = Parameters<typeof notifyFn>[1];

/** Every call `notify` received, in order, so per-target retry is observable. */
interface NotifyRecorder {
  readonly calls: NotifyParams[];
  readonly notify: typeof notifyFn;
}

const outcomesFor = (
  entries: ReadonlyArray<
    [
      ChatNotificationOutboxTarget,
      NotificationResult['outcomes'][number]['status'],
    ]
  >,
): NotificationResult => ({
  outcomes: entries.map(([target, status]) => ({
    platform: target.platform,
    channelId: target.channelId,
    status,
  })),
});

/**
 * A `notify` that answers each call from `answers` (last answer repeats once
 * exhausted), recording what it was asked to post to.
 */
const recordingNotify = (
  answers: ReadonlyArray<Awaited<ReturnType<typeof notifyFn>>>,
): NotifyRecorder => {
  const calls: NotifyParams[] = [];
  return {
    calls,
    notify: async (_relationId, params) => {
      calls.push(params);
      return answers[Math.min(calls.length - 1, answers.length - 1)];
    },
  };
};

const seedRow = (
  targets: ReadonlyArray<ChatNotificationOutboxTarget>,
  overrides: Partial<{
    state: 'pending' | 'claimed' | 'sent' | 'given-up';
    attempts: number;
    claimedAt: Date | null;
    nextAttemptAt: Date;
    result: unknown;
  }> = {},
) =>
  ChatNotificationOutbox.create({
    requestId: 'req-1',
    relationId: RELATION_ID,
    targets,
    markdown: 'someone created [/a](https://growi.example.test/a)',
    containsRestrictedPage: false,
    state: 'pending',
    ...overrides,
  });

describe('notificationDispatcher.drain', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_notification_dispatcher',
    ));
  });

  beforeEach(async () => {
    await ChatNotificationOutbox.deleteMany({});
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  it('posts every target of a pending row and marks it sent', async () => {
    await seedRow([TARGET_A, TARGET_B]);
    const recorder = recordingNotify([
      {
        ok: true,
        response: outcomesFor([
          [TARGET_A, 'posted'],
          [TARGET_B, 'posted'],
        ]),
      },
    ]);

    const summary = await createNotificationDispatcher({
      notify: recorder.notify,
    }).drain(new Date());

    expect(summary).toEqual({ sent: 1, failed: 0, givenUp: 0 });
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0].targets).toEqual([TARGET_A, TARGET_B]);

    const row = await ChatNotificationOutbox.findOne({});
    expect(row?.state).toBe('sent');
  });

  it('keeps the SAME requestId across a retry (Requirement 10.4)', async () => {
    const created = await seedRow([TARGET_A]);
    const recorder = recordingNotify([
      { ok: false, reason: 'unreachable' },
      { ok: true, response: outcomesFor([[TARGET_A, 'posted']]) },
    ]);
    const dispatcher = createNotificationDispatcher({
      notify: recorder.notify,
    });

    const first = new Date();
    await dispatcher.drain(first);
    // Far enough ahead that the backoff has certainly elapsed.
    await dispatcher.drain(new Date(first.getTime() + 60 * 60 * 1000));

    expect(recorder.calls.map((c) => c.requestId)).toEqual([
      created.requestId,
      created.requestId,
    ]);
  });

  it('retries ONLY the target that failed -- the target that already posted is never sent again', async () => {
    await seedRow([TARGET_A, TARGET_B]);
    const recorder = recordingNotify([
      {
        ok: true,
        response: outcomesFor([
          [TARGET_A, 'posted'],
          [TARGET_B, 'platform-error'],
        ]),
      },
      { ok: true, response: outcomesFor([[TARGET_B, 'posted']]) },
    ]);
    const dispatcher = createNotificationDispatcher({
      notify: recorder.notify,
    });

    const first = new Date();
    const firstSummary = await dispatcher.drain(first);
    expect(firstSummary).toEqual({ sent: 0, failed: 1, givenUp: 0 });

    const secondSummary = await dispatcher.drain(
      new Date(first.getTime() + 60 * 60 * 1000),
    );
    expect(secondSummary).toEqual({ sent: 1, failed: 0, givenUp: 0 });

    // The completion condition of task 8.2: the second round asks the proxy
    // for target B alone. A dispatcher that re-posted the whole target list
    // would double-post to A.
    expect(recorder.calls).toHaveLength(2);
    expect(recorder.calls[1].targets).toEqual([TARGET_B]);

    const row = await ChatNotificationOutbox.findOne({});
    expect(row?.state).toBe('sent');
  });

  it('does not claim a row whose backoff has not elapsed yet', async () => {
    await seedRow([TARGET_A]);
    const recorder = recordingNotify([{ ok: false, reason: 'unreachable' }]);
    const dispatcher = createNotificationDispatcher({
      notify: recorder.notify,
    });

    const first = new Date();
    await dispatcher.drain(first);
    const summary = await dispatcher.drain(new Date(first.getTime() + 1000));

    expect(summary).toEqual({ sent: 0, failed: 0, givenUp: 0 });
    expect(recorder.calls).toHaveLength(1);
  });

  it('marks the row given-up once the attempt limit is exceeded, and stops claiming it', async () => {
    await seedRow([TARGET_A]);
    const recorder = recordingNotify([
      { ok: true, response: outcomesFor([[TARGET_A, 'platform-error']]) },
    ]);
    const dispatcher = createNotificationDispatcher({
      notify: recorder.notify,
    });

    const start = new Date();
    const summaries: DrainSummary[] = [];
    for (let i = 0; i < NOTIFICATION_RETRY_CONFIG.maxAttempts; i++) {
      summaries.push(
        await dispatcher.drain(new Date(start.getTime() + i * 60 * 60 * 1000)),
      );
    }

    expect(summaries.at(-1)).toEqual({ sent: 0, failed: 0, givenUp: 1 });
    const row = await ChatNotificationOutbox.findOne({});
    expect(row?.state).toBe('given-up');
    expect(row?.attempts).toBe(NOTIFICATION_RETRY_CONFIG.maxAttempts);

    // A given-up row is a record for an operator, not work: further ticks
    // must leave it alone.
    const callsBefore = recorder.calls.length;
    const after = await dispatcher.drain(
      new Date(start.getTime() + 365 * 24 * 60 * 60 * 1000),
    );
    expect(after).toEqual({ sent: 0, failed: 0, givenUp: 0 });
    expect(recorder.calls).toHaveLength(callsBefore);
  });

  describe('inventory-not-ready', () => {
    it('does not count toward giving up, so the row survives far more rounds than a normal failure', async () => {
      await seedRow([TARGET_A]);
      const recorder = recordingNotify([
        {
          ok: true,
          response: outcomesFor([[TARGET_A, 'inventory-not-ready']]),
        },
      ]);
      const dispatcher = createNotificationDispatcher({
        notify: recorder.notify,
      });

      const start = new Date();
      // Twice as many rounds as a normal failure needs to reach `given-up`.
      const rounds = NOTIFICATION_RETRY_CONFIG.maxAttempts * 2;
      for (let i = 0; i < rounds; i++) {
        await dispatcher.drain(new Date(start.getTime() + i * 60 * 60 * 1000));
      }

      expect(recorder.calls).toHaveLength(rounds);
      const row = await ChatNotificationOutbox.findOne({});
      expect(row?.state).toBe('pending');
      expect(row?.attempts).toBe(0);
    });

    it('waits the longer, fixed interval before the next round', async () => {
      await seedRow([TARGET_A]);
      const recorder = recordingNotify([
        {
          ok: true,
          response: outcomesFor([[TARGET_A, 'inventory-not-ready']]),
        },
      ]);

      const now = new Date();
      await createNotificationDispatcher({ notify: recorder.notify }).drain(
        now,
      );

      const row = await ChatNotificationOutbox.findOne({});
      expect(row?.nextAttemptAt.getTime()).toBe(
        now.getTime() + INVENTORY_NOT_READY_RETRY_INTERVAL_MS,
      );
      // Longer than the very first ordinary backoff, which is the whole
      // point of separating the two.
      expect(INVENTORY_NOT_READY_RETRY_INTERVAL_MS).toBeGreaterThan(
        NOTIFICATION_RETRY_CONFIG.baseBackoffMs,
      );
    });

    it('DOES count when the same round also had an ordinary failure', async () => {
      await seedRow([TARGET_A, TARGET_B]);
      const recorder = recordingNotify([
        {
          ok: true,
          response: outcomesFor([
            [TARGET_A, 'inventory-not-ready'],
            [TARGET_B, 'platform-error'],
          ]),
        },
      ]);

      await createNotificationDispatcher({ notify: recorder.notify }).drain(
        new Date(),
      );

      const row = await ChatNotificationOutbox.findOne({});
      expect(row?.attempts).toBe(1);
    });
  });

  it('re-claims a row whose claim went stale (the process that took it died mid-send)', async () => {
    const now = new Date();
    await seedRow([TARGET_A], {
      state: 'claimed',
      claimedAt: new Date(now.getTime() - CLAIM_STALE_AFTER_MS - 1000),
    });
    const recorder = recordingNotify([
      { ok: true, response: outcomesFor([[TARGET_A, 'posted']]) },
    ]);

    const summary = await createNotificationDispatcher({
      notify: recorder.notify,
    }).drain(now);

    expect(summary).toEqual({ sent: 1, failed: 0, givenUp: 0 });
    expect(recorder.calls).toHaveLength(1);
  });

  it('leaves a freshly claimed row alone (another instance is sending it right now)', async () => {
    const now = new Date();
    await seedRow([TARGET_A], {
      state: 'claimed',
      claimedAt: new Date(now.getTime() - 1000),
    });
    const recorder = recordingNotify([
      { ok: true, response: outcomesFor([[TARGET_A, 'posted']]) },
    ]);

    const summary = await createNotificationDispatcher({
      notify: recorder.notify,
    }).drain(now);

    expect(summary).toEqual({ sent: 0, failed: 0, givenUp: 0 });
    expect(recorder.calls).toHaveLength(0);
  });

  it('processes every claimable row in one call (Requirement 2.6 fan-out is many rows)', async () => {
    await seedRow([TARGET_A]);
    await seedRow([TARGET_B]);
    const recorder = recordingNotify([
      { ok: true, response: outcomesFor([[TARGET_A, 'posted']]) },
      { ok: true, response: outcomesFor([[TARGET_B, 'posted']]) },
    ]);

    const summary = await createNotificationDispatcher({
      notify: recorder.notify,
    }).drain(new Date());

    expect(summary).toEqual({ sent: 2, failed: 0, givenUp: 0 });
    const states = await ChatNotificationOutbox.find({}).distinct('state');
    expect(states).toEqual(['sent']);
  });

  it('records the per-target outcomes an operator has to read (Requirement 2.4)', async () => {
    await seedRow([TARGET_A]);
    const recorder = recordingNotify([
      {
        ok: true,
        response: {
          outcomes: [
            {
              platform: TARGET_A.platform,
              channelId: TARGET_A.channelId,
              status: 'bot-not-in-channel',
              remedy: 'invite the bot to the channel',
            },
          ],
        },
      },
    ]);

    await createNotificationDispatcher({ notify: recorder.notify }).drain(
      new Date(),
    );

    const row = await ChatNotificationOutbox.findOne({});
    expect(row?.result).toMatchObject({
      outcomes: [
        expect.objectContaining({
          channelId: TARGET_A.channelId,
          status: 'bot-not-in-channel',
          remedy: 'invite the bot to the channel',
        }),
      ],
    });
  });

  it('does not lose an already-posted target from the record when a later round retries the rest', async () => {
    await seedRow([TARGET_A, TARGET_B]);
    const recorder = recordingNotify([
      {
        ok: true,
        response: outcomesFor([
          [TARGET_A, 'posted'],
          [TARGET_B, 'timeout'],
        ]),
      },
      { ok: true, response: outcomesFor([[TARGET_B, 'posted']]) },
    ]);
    const dispatcher = createNotificationDispatcher({
      notify: recorder.notify,
    });

    const first = new Date();
    await dispatcher.drain(first);
    await dispatcher.drain(new Date(first.getTime() + 60 * 60 * 1000));

    const row = await ChatNotificationOutbox.findOne({});
    const result = row?.result as NotificationResult;
    expect(result.outcomes.map((o) => [o.channelId, o.status]).sort()).toEqual([
      [TARGET_A.channelId, 'posted'],
      [TARGET_B.channelId, 'posted'],
    ]);
  });

  it('treats a transport failure (no result at all) as an ordinary failure of every pending target', async () => {
    await seedRow([TARGET_A, TARGET_B]);
    const recorder = recordingNotify([{ ok: false, reason: 'unreachable' }]);

    const summary = await createNotificationDispatcher({
      notify: recorder.notify,
    }).drain(new Date());

    expect(summary).toEqual({ sent: 0, failed: 1, givenUp: 0 });
    const row = await ChatNotificationOutbox.findOne({});
    expect(row?.state).toBe('pending');
    expect(row?.attempts).toBe(1);
  });
});
