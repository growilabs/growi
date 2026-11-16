import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:add-chat-agent-request-indexes');

const COLLECTION_NAME = 'chat_agent_requests';

const PAIR_INDEX = 'relationId_1_requestId_1_unique';
const RUNNING_INDEX = 'userId_1_running_unique';
const TTL_INDEX = 'startedAt_1_ttl';

const ONE_DAY_IN_SECONDS = 24 * 60 * 60;

/**
 * Indexes of the running `agent` requests (design.md "依頼の行の状態"):
 * - one row per (relationId, requestId), so a re-sent request is recognised;
 * - one `running` row per GROWI user (requirement 15.12) -- a partial unique
 *   index, so finished rows never block a new request;
 * - rows disappear 24 hours after they started.
 *
 * createIndex creates the collection if absent and is a no-op when the same
 * index already exists, so a second run changes nothing.
 */
export async function up(db) {
  logger.info('Apply migration');

  const collection = db.collection(COLLECTION_NAME);

  await collection.createIndex(
    { relationId: 1, requestId: 1 },
    { name: PAIR_INDEX, unique: true },
  );
  await collection.createIndex(
    { userId: 1 },
    {
      name: RUNNING_INDEX,
      unique: true,
      partialFilterExpression: { state: 'running' },
    },
  );
  await collection.createIndex(
    { startedAt: 1 },
    { name: TTL_INDEX, expireAfterSeconds: ONE_DAY_IN_SECONDS },
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
  for (const name of [PAIR_INDEX, RUNNING_INDEX, TTL_INDEX]) {
    if (await collection.indexExists(name)) {
      await collection.dropIndex(name);
    }
  }
}
