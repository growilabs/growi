import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:migrate:add-indexes-to-extractionfailurelogs',
);

const COLLECTION = 'extractionfailurelogs';

// Same names and options as the Mongoose schema that used to create them, so
// a database that already has them is left as is.
const INDEXES = [
  {
    key: { occurredAt: 1 },
    // Entries expire 90 days after they occurred
    options: { name: 'occurredAt_1', expireAfterSeconds: 60 * 60 * 24 * 90 },
  },
  { key: { attachmentId: 1 }, options: { name: 'attachmentId_1' } },
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

  const collection = db.collection(COLLECTION);
  for (const { options } of INDEXES) {
    if (await collection.indexExists(options.name)) {
      await collection.dropIndex(options.name);
    }
  }
}
