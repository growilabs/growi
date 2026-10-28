import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:add-unique-index-to-searchhistories');

const COLLECTION_NAME = 'searchhistories';
// Must match `@@unique(map:)` of `searchhistories` in prisma/schema.prisma
const INDEX_NAME = 'user_1_keyword_1';

/**
 * Raw `db` handle only, so the migration keeps working as the application code evolves.
 */
export async function up(db) {
  logger.info('Apply migration: add unique index to searchhistories');

  const collection = db.collection(COLLECTION_NAME);

  // The unique index cannot be built while duplicates exist. Keep the most recently
  // searched row of each (user, keyword) pair.
  const duplicates = collection.aggregate(
    [
      { $sort: { lastSearchedAt: -1 } },
      {
        $group: {
          _id: { user: '$user', keyword: '$keyword' },
          ids: { $push: '$_id' },
        },
      },
      { $match: { 'ids.1': { $exists: true } } },
    ],
    { allowDiskUse: true },
  );

  let removed = 0;
  for await (const group of duplicates) {
    const res = await collection.deleteMany({ _id: { $in: group.ids.slice(1) } });
    removed += res.deletedCount ?? 0;
  }
  if (removed > 0) {
    logger.info(`Removed ${removed} duplicated search history row(s)`);
  }

  await collection.createIndex(
    { user: 1, keyword: 1 },
    { unique: true, name: INDEX_NAME },
  );

  logger.info('Migration has successfully applied');
}

export async function down(db) {
  logger.info('Rollback migration: add unique index to searchhistories');

  const exists = await db
    .listCollections({ name: COLLECTION_NAME }, { nameOnly: true })
    .toArray();
  if (exists.length > 0) {
    const collection = db.collection(COLLECTION_NAME);
    if (await collection.indexExists(INDEX_NAME)) {
      await collection.dropIndex(INDEX_NAME);
    }
  }

  logger.info('Rollback has successfully applied');
}
