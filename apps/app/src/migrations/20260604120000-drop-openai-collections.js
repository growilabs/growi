import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:drop-openai-collections');

// Collections backing the deprecated OpenAI features (AI assistant, threads,
// vector stores). These are dropped wholesale; no remote OpenAI vector store
// is touched by this migration.
const COLLECTION_NAMES = [
  'aiassistants',
  'threadrelations',
  'vectorstores',
  'vectorstorefilerelations',
];

async function dropCollectionIfExists(db, collectionName) {
  // Check existence first so dropping an absent collection is a no-op.
  const items = await db
    .listCollections({ name: collectionName }, { nameOnly: true })
    .toArray();
  if (items.length === 0) {
    logger.info(`Collection "${collectionName}" does not exist. Skipping.`);
    return;
  }

  await db.collection(collectionName).drop();
  logger.info(`Dropped collection "${collectionName}".`);
}

module.exports = {
  async up(db) {
    logger.info('Apply migration');

    for (const collectionName of COLLECTION_NAMES) {
      // eslint-disable-next-line no-await-in-loop
      await dropCollectionIfExists(db, collectionName);
    }
  },

  async down() {
    // No rollback: dropped collections are not re-created.
  },
};
