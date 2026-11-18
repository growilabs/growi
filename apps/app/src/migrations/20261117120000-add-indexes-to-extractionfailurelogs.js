import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:migrate:add-indexes-to-extractionfailurelogs',
);

const COLLECTION = 'extractionfailurelogs';

// createIndex is a no-op for an index that already exists with the same name
// and options.
const INDEXES = [
  {
    key: { occurredAt: 1 },
    // Entries expire 90 days after they occurred
    options: { name: 'occurredAt_1', expireAfterSeconds: 60 * 60 * 24 * 90 },
  },
  {
    key: { retentionGroupHash: 1 },
    options: { name: 'retentionGroupHash_1' },
  },
];

export async function up(db) {
  logger.info('Apply migration');

  const collection = db.collection(COLLECTION);
  for (const { key, options } of INDEXES) {
    await collection.createIndex(key, options);
  }
}

export async function down(db) {
  logger.info('Rollback migration');

  // indexExists() throws when the collection does not exist
  const items = await db
    .listCollections({ name: COLLECTION }, { nameOnly: true })
    .toArray();
  if (items.length === 0) {
    return;
  }

  const collection = db.collection(COLLECTION);
  for (const { options } of INDEXES) {
    if (await collection.indexExists(options.name)) {
      await collection.dropIndex(options.name);
    }
  }
}
