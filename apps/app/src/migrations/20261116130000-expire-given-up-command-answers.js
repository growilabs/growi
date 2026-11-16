import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:expire-given-up-command-answers');

const COLLECTION_NAME = 'chat_notification_outbox';

// Named explicitly: the default name for this key is already taken by the
// schema's expiry of `sent` rows (`createdAt_1`, 30 days, `state: 'sent'`).
const INDEX_NAME = 'createdAt_1_command_answer_given_up_ttl';

const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;

/**
 * A command answer that could not be sent is kept for 7 days and then removed
 * (design.md "答えの保存"). A row gives up within about an hour of being
 * written, so expiring by `createdAt` keeps it about 7 days after giving up.
 * Given-up notification rows are not covered: they stay for an operator.
 *
 * createIndex creates the collection if absent and is a no-op when the same
 * index already exists, so a second run changes nothing.
 */
export async function up(db) {
  logger.info('Apply migration');

  await db.collection(COLLECTION_NAME).createIndex(
    { createdAt: 1 },
    {
      name: INDEX_NAME,
      expireAfterSeconds: SEVEN_DAYS_IN_SECONDS,
      partialFilterExpression: { kind: 'command-answer', state: 'given-up' },
    },
  );
}

export async function down(db) {
  logger.info('Rollback migration');

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
