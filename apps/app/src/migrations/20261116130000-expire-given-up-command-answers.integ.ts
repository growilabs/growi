/**
 * Integration test for the expiry index of given-up command-answer rows in the
 * chat outbox, next to the indexes the collection already has.
 */
import type { Collection, Db, Document } from 'mongodb';
import mongoose from 'mongoose';

import { ChatOutboxRow } from '~/features/chat-integration/server/outbox/models/chat-outbox';

const INDEX_NAME = 'createdAt_1_command_answer_given_up_ttl';
const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;

const describeIndex = ({
  name,
  key,
  expireAfterSeconds,
  partialFilterExpression,
  unique,
}: Document) => ({
  name,
  key,
  expireAfterSeconds,
  partialFilterExpression,
  unique,
});

describe('expire-given-up-command-answers', () => {
  let db: Db;
  let collection: Collection;
  let migrate: typeof import('./20261116130000-expire-given-up-command-answers');

  const indexes = async () =>
    (await collection.indexes())
      .map(describeIndex)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  beforeAll(async () => {
    migrate = await import('./20261116130000-expire-given-up-command-answers');
    const connectedDb = mongoose.connection.db;
    if (connectedDb == null) {
      throw new Error('The test setup did not connect mongoose');
    }
    db = connectedDb;
    collection = db.collection('chat_notification_outbox');
    // The schema's own indexes, the sent-row expiry among them, and the
    // previous migration's index exist on every running GROWI; the new index
    // has to be creatable next to them.
    await ChatOutboxRow.init();
    const previous = await import(
      './20261116120000-add-kind-to-chat-notification-outbox'
    );
    await previous.up(db);
  });

  beforeEach(async () => {
    // The template database already ran this migration; start without its index.
    await migrate.down(db);
  });

  it('expires given-up command-answer rows 7 days after they were written', async () => {
    await migrate.up(db);

    expect((await indexes()).find((i) => i.name === INDEX_NAME)).toEqual({
      name: INDEX_NAME,
      key: { createdAt: 1 },
      expireAfterSeconds: SEVEN_DAYS_IN_SECONDS,
      partialFilterExpression: { kind: 'command-answer', state: 'given-up' },
      unique: undefined,
    });
  });

  it('leaves every index the collection already had as it was', async () => {
    const before = await indexes();

    await migrate.up(db);

    const after = await indexes();
    expect(after.filter((i) => i.name !== INDEX_NAME)).toEqual(before);
    expect(before).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'createdAt_1',
          expireAfterSeconds: 30 * 24 * 60 * 60,
          partialFilterExpression: { state: 'sent' },
        }),
        expect.objectContaining({
          name: 'relationId_1_requestId_1_command_answer_unique',
          unique: true,
        }),
      ]),
    );
  });

  it('is a no-op when run a second time', async () => {
    await migrate.up(db);
    const afterFirst = await indexes();

    await migrate.up(db);

    expect(await indexes()).toEqual(afterFirst);
  });

  it('removes only its own index on rollback', async () => {
    const before = await indexes();
    await migrate.up(db);

    await migrate.down(db);

    expect(await indexes()).toEqual(before);
  });
});
