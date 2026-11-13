import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:migrate:add-endpoint-index-to-activities',
);

const ACTIVITIES = 'activities';

// Must match `@@index([endpoint], map: "endpoint_1")` in schema.prisma.
const INDEX_NAME = 'endpoint_1';

// Backs the auditlog endpoint suggestion's MongoDB fallback. Created here, not
// by a Mongoose `index: true`: deploys never run `prisma db push`, so the index
// would stop being provisioned once the Activity model leaves Mongoose.
export async function up(db) {
  logger.info('Apply migration');

  // A no-op when the same index already exists (e.g. built by an earlier
  // Mongoose `index: true` on a pre-release build).
  await db
    .collection(ACTIVITIES)
    .createIndex({ endpoint: 1 }, { name: INDEX_NAME });
}

export async function down(db) {
  logger.info('Rollback migration');

  const items = await db
    .listCollections({ name: ACTIVITIES }, { nameOnly: true })
    .toArray();
  if (items.length === 0) {
    return;
  }

  const collection = db.collection(ACTIVITIES);
  if (await collection.indexExists(INDEX_NAME)) {
    await collection.dropIndex(INDEX_NAME);
  }
}
