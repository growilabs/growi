import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:migrate:add-kind-to-chat-notification-outbox',
);

const COLLECTION_NAME = 'chat_notification_outbox';

// Named explicitly: the default name for these keys is already taken by the
// schema's non-unique (relationId, requestId) index.
const INDEX_NAME = 'relationId_1_requestId_1_command_answer_unique';

/**
 * Every row written before the outbox had kinds is a notification. The
 * dispatcher only claims rows whose kind it can send, so a row left without
 * a kind would never be sent. Rows that already have a kind are left alone,
 * which makes a second run a no-op.
 *
 * `migrate-mongo` passes its own `db`, used here instead of a second mongoose
 * connection.
 */
export async function up(db) {
  logger.info('Apply migration');

  const collection = db.collection(COLLECTION_NAME);

  const { modifiedCount } = await collection.updateMany(
    { kind: { $exists: false } },
    { $set: { kind: 'notification' } },
  );
  logger.info(`Set kind: 'notification' on ${modifiedCount} row(s)`);

  // One answer per agent request. createIndex creates the collection if absent
  // and is a no-op when the same index already exists.
  await collection.createIndex(
    { relationId: 1, requestId: 1 },
    {
      name: INDEX_NAME,
      unique: true,
      partialFilterExpression: { kind: 'command-answer' },
    },
  );
}

export async function down(db) {
  logger.info('Rollback migration');

  // `kind` is left on the rows: code without kinds ignores the field.
  const collections = await db
    .listCollections({ name: COLLECTION_NAME }, { nameOnly: true })
    .toArray();
  if (collections.length === 0) {
    return;
  }
  const collection = db.collection(COLLECTION_NAME);
  if (await collection.indexExists(INDEX_NAME)) {
    await collection.dropIndex(INDEX_NAME);
  }
}
