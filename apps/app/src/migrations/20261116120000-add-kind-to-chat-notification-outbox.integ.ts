/**
 * Integration test for the chat outbox `kind` backfill and the unique index on
 * command-answer rows.
 *
 * Legacy rows are inserted through the raw driver so that the Mongoose schema
 * default for `kind` does not fill the field the migration is meant to fill.
 */
import type { Collection, Db } from 'mongodb';
import mongoose from 'mongoose';

import { createNotificationDeliverer } from '~/features/chat-integration/server/notification/notification-deliverer';
import { ChatOutboxRow } from '~/features/chat-integration/server/outbox/models/chat-outbox';
import { createOutboxDispatcher } from '~/features/chat-integration/server/outbox/outbox-dispatcher';
import type { notify as notifyFn } from '~/features/chat-integration/server/proxy-client';

const RELATION_ID = 'rel-migration-outbox-kind';

const legacyNotificationRow = (requestId: string) => ({
  requestId,
  relationId: RELATION_ID,
  targets: [{ platform: 'slack', channelId: 'C1' }],
  markdown: 'someone created /a',
  containsRestrictedPage: false,
  state: 'pending',
  attempts: 0,
  claimedAt: null,
  nextAttemptAt: new Date(0),
  result: null,
  createdAt: new Date(0),
});

const answerRow = (requestId: string) => ({
  kind: 'command-answer',
  requestId,
  relationId: RELATION_ID,
  answer: { kind: 'text', markdown: 'the answer', sources: [] },
  state: 'pending',
  attempts: 0,
  claimedAt: null,
  nextAttemptAt: new Date(0),
  result: null,
  createdAt: new Date(0),
});

describe('add-kind-to-chat-notification-outbox', () => {
  let db: Db;
  let collection: Collection;
  let migrate: typeof import('./20261116120000-add-kind-to-chat-notification-outbox');

  beforeAll(async () => {
    migrate = await import(
      './20261116120000-add-kind-to-chat-notification-outbox'
    );
    const connectedDb = mongoose.connection.db;
    if (connectedDb == null) {
      throw new Error('The test setup did not connect mongoose');
    }
    db = connectedDb;
    collection = db.collection('chat_notification_outbox');
    // The schema's own indexes exist on every running GROWI before this
    // migration runs; the new index has to be creatable next to them.
    await ChatOutboxRow.init();
  });

  beforeEach(async () => {
    // The template database already ran this migration; start without its index.
    await migrate.down(db);
  });

  afterEach(async () => {
    await collection.deleteMany({ relationId: RELATION_ID });
  });

  it('marks rows without a kind as notifications and leaves rows with a kind as they are', async () => {
    await collection.insertMany([
      legacyNotificationRow('req-legacy'),
      answerRow('req-answer'),
    ]);

    await migrate.up(db);

    const kinds = await collection
      .find({ relationId: RELATION_ID })
      .project<{ requestId: string; kind: string }>({
        _id: 0,
        requestId: 1,
        kind: 1,
      })
      .sort({ requestId: 1 })
      .toArray();
    expect(kinds).toEqual([
      { requestId: 'req-answer', kind: 'command-answer' },
      { requestId: 'req-legacy', kind: 'notification' },
    ]);
  });

  it('sends a legacy row as a notification once the migration has run', async () => {
    await collection.insertOne(legacyNotificationRow('req-legacy'));
    const requestIds: string[] = [];
    const notify: typeof notifyFn = async (_relationId, params) => {
      requestIds.push(params.requestId);
      return {
        ok: true,
        response: {
          outcomes: params.targets.map((target) => ({
            ...target,
            status: 'posted' as const,
          })),
        },
      };
    };
    const dispatcher = createOutboxDispatcher({
      deliverers: { notification: createNotificationDeliverer({ notify }) },
    });
    const now = new Date();

    // A row without a kind is not one the dispatcher knows how to send.
    await dispatcher.drain(now);
    expect(requestIds).toEqual([]);

    await migrate.up(db);
    await dispatcher.drain(now);

    expect(requestIds).toEqual(['req-legacy']);
    const row = await collection.findOne({ requestId: 'req-legacy' });
    expect(row?.state).toBe('sent');
  });

  it('allows only one command-answer row per (relationId, requestId)', async () => {
    await migrate.up(db);
    await collection.insertOne(answerRow('req-1'));

    await expect(collection.insertOne(answerRow('req-1'))).rejects.toThrow(
      /E11000/,
    );
    expect(
      await collection.countDocuments({
        relationId: RELATION_ID,
        requestId: 'req-1',
      }),
    ).toBe(1);
  });

  it('does not restrict notification rows that share a (relationId, requestId)', async () => {
    await migrate.up(db);

    await collection.insertMany([
      { ...legacyNotificationRow('req-1'), kind: 'notification' },
      { ...legacyNotificationRow('req-1'), kind: 'notification' },
      answerRow('req-1'),
    ]);

    expect(
      await collection.countDocuments({
        relationId: RELATION_ID,
        requestId: 'req-1',
      }),
    ).toBe(3);
  });

  it('is a no-op when run a second time', async () => {
    await collection.insertMany([
      legacyNotificationRow('req-legacy'),
      answerRow('req-answer'),
    ]);
    await migrate.up(db);
    const rowsAfterFirst = await collection
      .find({ relationId: RELATION_ID })
      .toArray();
    const indexesAfterFirst = await collection.indexes();

    await migrate.up(db);

    expect(
      await collection.find({ relationId: RELATION_ID }).toArray(),
    ).toEqual(rowsAfterFirst);
    expect(await collection.indexes()).toEqual(indexesAfterFirst);
  });
});
