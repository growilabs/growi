import type { AgentAnswer } from '@growi/chat';
import type { MongoMemoryServer } from 'mongodb-memory-server-core';
import { type MockProxy, mock } from 'vitest-mock-extended';

import {
  connectSelfContainedMongo,
  disconnectSelfContainedMongo,
} from '^/test/setup/mongo/self-contained-connection';

import type { IntegrationPresence } from '../integration-presence';
import type { NotificationOutboxEntry } from './chat-outbox';
import { createChatOutbox } from './chat-outbox';
import { ChatOutboxRow } from './models/chat-outbox';
import type { Deliverer, OutboxDispatcher } from './outbox-dispatcher';
import { createOutboxDispatcher } from './outbox-dispatcher';

const NOTIFICATION: NotificationOutboxEntry = {
  kind: 'notification',
  relationId: 'rel-1',
  targets: [{ platform: 'slack', channelId: 'C1' }],
  markdown: 'someone created [/a](https://growi.example.com/a)',
  containsRestrictedPage: false,
};

const ANSWER: AgentAnswer = {
  kind: 'text',
  markdown: 'the answer',
  sources: [],
};

/** A dispatcher that accepts drain requests and sends nothing. */
const idleDispatcher = (): MockProxy<OutboxDispatcher> => {
  const dispatcher = mock<OutboxDispatcher>();
  dispatcher.requestDrain.mockResolvedValue(undefined);
  return dispatcher;
};

/** An outbox whose writes are real but whose sending is switched off. */
const writeOnlyOutbox = () =>
  createChatOutbox({
    dispatcher: idleDispatcher(),
    presence: mock<IntegrationPresence>(),
  });

describe('ChatOutbox.enqueue', () => {
  let mongod: MongoMemoryServer | undefined;

  beforeAll(async () => {
    ({ mongod } = await connectSelfContainedMongo(
      'growi_test_unit_notification_outbox',
    ));
  });

  beforeEach(async () => {
    await ChatOutboxRow.deleteMany({});
  });

  afterAll(async () => {
    await disconnectSelfContainedMongo(mongod);
  });

  describe('a notification entry', () => {
    it('creates exactly one row with all fields persisted and a requestId assigned', async () => {
      await writeOnlyOutbox().enqueue(NOTIFICATION);

      const rows = await ChatOutboxRow.find({});
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row.kind).toBe('notification');
      expect(row.relationId).toBe('rel-1');
      expect(row.toObject().targets).toEqual([
        { platform: 'slack', channelId: 'C1' },
      ]);
      expect(row.markdown).toBe(
        'someone created [/a](https://growi.example.com/a)',
      );
      expect(row.containsRestrictedPage).toBe(false);
      expect(row.state).toBe('pending');
      expect(typeof row.requestId).toBe('string');
      expect(row.requestId.length).toBeGreaterThan(0);
    });

    it('mints a FRESH requestId for each call -- two enqueue calls for the same relation never reuse an id', async () => {
      const outbox = writeOnlyOutbox();
      await outbox.enqueue({ ...NOTIFICATION, markdown: 'first notification' });
      await outbox.enqueue({
        ...NOTIFICATION,
        markdown: 'second, unrelated notification',
      });

      const rows = await ChatOutboxRow.find({}).sort({ markdown: 1 });
      expect(rows).toHaveLength(2);
      expect(rows[0].requestId).not.toBe(rows[1].requestId);

      // This proves ONLY that a brand-new logical notification gets a fresh
      // id -- a retry of the same notification re-sends the SAME row and
      // never calls `enqueue` again.
    });

    it('persists a restricted page notification with containsRestrictedPage true', async () => {
      await writeOnlyOutbox().enqueue({
        ...NOTIFICATION,
        targets: [{ platform: 'discord', channelId: 'D1' }],
        markdown: 'someone edited [/secret](https://growi.example.com/secret)',
        containsRestrictedPage: true,
      });

      const [row] = await ChatOutboxRow.find({});
      expect(row.containsRestrictedPage).toBe(true);
    });
  });

  // The schema defaults `kind` to 'notification', so only a non-default kind
  // proves that `enqueue` writes the entry's own kind into the document.
  describe('a command-answer entry', () => {
    it('stores the row as a command answer with the caller’s requestId and the answer', async () => {
      await writeOnlyOutbox().enqueue({
        kind: 'command-answer',
        relationId: 'rel-1',
        requestId: 'req-agent-1',
        answer: ANSWER,
      });

      const stored = await ChatOutboxRow.collection.findOne({});
      expect(stored?.kind).toBe('command-answer');
      expect(stored?.requestId).toBe('req-agent-1');
      expect(stored?.answer).toEqual(ANSWER);
      expect(stored?.state).toBe('pending');
    });
  });

  describe('starting to send (Requirement 2.10)', () => {
    it('asks the dispatcher to drain once, after the row is written', async () => {
      const dispatcher = mock<OutboxDispatcher>();
      const rowsWhenRequested: Promise<number>[] = [];
      dispatcher.requestDrain.mockImplementation(() => {
        rowsWhenRequested.push(ChatOutboxRow.countDocuments({}).exec());
        return Promise.resolve();
      });

      await createChatOutbox({
        dispatcher,
        presence: mock<IntegrationPresence>(),
      }).enqueue(NOTIFICATION);

      expect(dispatcher.requestDrain).toHaveBeenCalledTimes(1);
      expect(await Promise.all(rowsWhenRequested)).toEqual([1]);
    });

    it('resolves once the row is written, without waiting for the send', async () => {
      const dispatcher = mock<OutboxDispatcher>();
      dispatcher.requestDrain.mockReturnValue(new Promise<void>(() => {}));

      await createChatOutbox({
        dispatcher,
        presence: mock<IntegrationPresence>(),
      }).enqueue(NOTIFICATION);

      expect(await ChatOutboxRow.countDocuments({})).toBe(1);
    });

    it('does not ask for a drain when the row write fails', async () => {
      const dispatcher = idleDispatcher();

      await expect(
        createChatOutbox({
          dispatcher,
          presence: mock<IntegrationPresence>(),
        }).enqueue({ ...NOTIFICATION, markdown: '' }),
      ).rejects.toThrow();

      expect(dispatcher.requestDrain).not.toHaveBeenCalled();
    });

    it('sends the written notification through the real dispatcher without any cron tick', async () => {
      let delivered: (requestId: string) => void = () => {};
      const deliveredRequestId = new Promise<string>((resolve) => {
        delivered = resolve;
      });
      const deliverer = vi.fn<Deliverer>((row) => {
        delivered(row.requestId);
        return Promise.resolve({ outcome: 'sent' });
      });
      const dispatcher = createOutboxDispatcher({
        deliverers: { notification: deliverer },
      });

      await createChatOutbox({
        dispatcher,
        presence: mock<IntegrationPresence>(),
      }).enqueue(NOTIFICATION);

      const [row] = await ChatOutboxRow.find({});
      expect(await deliveredRequestId).toBe(row.requestId);
      // Let the drain finish settling before the next test clears the rows.
      await dispatcher.requestDrain();
      expect((await ChatOutboxRow.findOne({}))?.state).toBe('sent');
    });

    it('never passes a failure inside the requested drain on to the caller', async () => {
      let failed: () => void = () => {};
      const failedOnce = new Promise<void>((resolve) => {
        failed = resolve;
      });
      const deliverer = vi.fn<Deliverer>(() => {
        failed();
        return Promise.reject(new Error('proxy exploded'));
      });
      const dispatcher = createOutboxDispatcher({
        deliverers: { notification: deliverer },
      });

      await expect(
        createChatOutbox({
          dispatcher,
          presence: mock<IntegrationPresence>(),
        }).enqueue(NOTIFICATION),
      ).resolves.toBeUndefined();

      await failedOnce;
      await expect(dispatcher.requestDrain()).resolves.toBeUndefined();
    });
  });

  describe('presence marking', () => {
    it('marks presence once with the time of the write when the row is persisted', async () => {
      const presence = mock<IntegrationPresence>();
      const before = Date.now();

      await createChatOutbox({
        presence,
        dispatcher: idleDispatcher(),
      }).enqueue(NOTIFICATION);

      expect(await ChatOutboxRow.countDocuments({})).toBe(1);
      expect(presence.markPresent).toHaveBeenCalledTimes(1);
      const [markedAt] = presence.markPresent.mock.calls[0];
      expect(markedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(markedAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('does not mark presence when the row write fails', async () => {
      const presence = mock<IntegrationPresence>();

      await expect(
        createChatOutbox({ presence, dispatcher: idleDispatcher() }).enqueue({
          ...NOTIFICATION,
          markdown: '',
        }),
      ).rejects.toThrow();

      expect(presence.markPresent).not.toHaveBeenCalled();
      expect(await ChatOutboxRow.countDocuments({})).toBe(0);
    });
  });
});
