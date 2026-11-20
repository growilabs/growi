import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:migrate:add-change-proposal-reviewer-indexes',
);

const COLLECTION = 'changeproposals';

const REVIEWER_QUEUE_INDEX = {
  key: { lifecycle: 1, 'reviewers.id': 1, _id: 1 },
  options: { name: 'lifecycle_1_reviewers.id_1__id_1' },
};

// Each array is filled separately, so a document that has only one of them keeps it.
const BACKFILLED_ARRAYS = ['reviewers', 'reviews'];

export async function up(db) {
  logger.info('Apply migration');

  const collection = db.collection(COLLECTION);
  for (const field of BACKFILLED_ARRAYS) {
    await collection.updateMany(
      { [field]: { $exists: false } },
      { $set: { [field]: [] } },
    );
  }

  // A no-op when the same index already exists.
  await collection.createIndex(
    REVIEWER_QUEUE_INDEX.key,
    REVIEWER_QUEUE_INDEX.options,
  );
}

// The backfilled empty arrays stay: they cannot be told apart from arrays that
// were emptied later, and reading them is harmless to the previous schema.
export async function down(db) {
  logger.info('Rollback migration');

  const collection = db.collection(COLLECTION);
  if (await collection.indexExists(REVIEWER_QUEUE_INDEX.options.name)) {
    await collection.dropIndex(REVIEWER_QUEUE_INDEX.options.name);
  }
}
