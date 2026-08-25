import mongoose from 'mongoose';

import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:migrate:add-unique-key-index-to-auditlog-es-sync-collections',
);

// Prisma-only collections (no mongoose model, no `prisma db push` in deploy), so their
// `key @unique` index must be provisioned here. Without it, concurrent upserts of the same
// fixed key across instances could create duplicate docs and break findUnique/upsert.
const COLLECTION_NAMES = [
  'auditlog_es_sync_status',
  'changestream_resume_tokens',
];

const INDEX_NAME = 'key_1';

// A pre-existing duplicate `key` would make the unique index build throw, leaving the
// collection without the index it needs. Drop the older duplicates first, keeping the
// newest doc per key (ObjectId embeds creation time, so the greatest _id is newest).
async function dedupeByKey(collection) {
  const groups = await collection
    .aggregate([
      { $group: { _id: '$key', ids: { $push: '$_id' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  const idsToRemove = groups.flatMap((group) => {
    // Byte-wise compare of the 12-byte ObjectId; its leading 4-byte timestamp makes this
    // creation order, so the last element is the newest doc to keep.
    const ids = [...group.ids].sort((a, b) => Buffer.compare(a.id, b.id));
    const removable = ids.slice(0, -1);
    logger.warn(
      `Removing ${removable.length} duplicate doc(s) for key="${group._id}" before building the unique index`,
    );
    return removable;
  });

  if (idsToRemove.length > 0) {
    await collection.deleteMany({ _id: { $in: idsToRemove } });
  }
}

async function dropIndexIfExists(db, collectionName, indexName) {
  const items = await db
    .listCollections({ name: collectionName }, { nameOnly: true })
    .toArray();
  if (items.length === 0) {
    return;
  }

  const collection = db.collection(collectionName);
  if (await collection.indexExists(indexName)) {
    await collection.dropIndex(indexName);
  }
}

export async function up() {
  logger.info('Apply migration');

  await mongoose.connect(getMongoUri(), mongoOptions);

  // createIndex creates the collection if absent and is a no-op when the same index
  // already exists, so this is safe whether or not the index was provisioned elsewhere.
  await Promise.all(
    COLLECTION_NAMES.map(async (name) => {
      const collection = mongoose.connection.collection(name);
      await dedupeByKey(collection);
      await collection.createIndex({ key: 1 }, { unique: true });
    }),
  );
}

export async function down(db) {
  logger.info('Rollback migration');

  await mongoose.connect(getMongoUri(), mongoOptions);

  await Promise.all(
    COLLECTION_NAMES.map((name) => dropIndexIfExists(db, name, INDEX_NAME)),
  );
}
