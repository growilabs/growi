import mongoose from 'mongoose';

import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:add-indexes-to-commentreactions');

const COLLECTION_NAME = 'commentreactions';

// Names must equal the `map` of `model commentreactions` in prisma/schema.prisma.
const UNIQUE_INDEX_NAME = 'comment_1_user_1_emoji_1';
const PAGE_INDEX_NAME = 'page_1';

// Design rationale: .kiro/specs/comment-reactions/design.md ("index migration").
// A pre-existing duplicate would make the unique index build throw. Keep the oldest doc
// per (comment, user, emoji): its createdAt drives the chip order.
async function dedupeReactions(collection) {
  const groups = await collection
    .aggregate([
      {
        $group: {
          _id: { comment: '$comment', user: '$user', emoji: '$emoji' },
          ids: { $push: '$_id' },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  const idsToRemove = groups.flatMap((group) => {
    // Byte-wise compare of the 12-byte ObjectId; its leading 4-byte timestamp makes this
    // creation order, so the first element is the oldest doc to keep.
    const ids = [...group.ids].sort((a, b) => Buffer.compare(a.id, b.id));
    const removable = ids.slice(1);
    logger.warn(
      `Removing ${removable.length} duplicate doc(s) for comment=${group._id.comment} user=${group._id.user} emoji="${group._id.emoji}" before building the unique index`,
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

  const collection = mongoose.connection.collection(COLLECTION_NAME);
  await dedupeReactions(collection);

  // createIndex creates the collection if absent and is a no-op when the same index
  // already exists, so this is safe to re-run.
  await collection.createIndex(
    { comment: 1, user: 1, emoji: 1 },
    { unique: true, name: UNIQUE_INDEX_NAME },
  );
  await collection.createIndex({ page: 1 }, { name: PAGE_INDEX_NAME });
}

export async function down(db) {
  logger.info('Rollback migration');

  await mongoose.connect(getMongoUri(), mongoOptions);

  await dropIndexIfExists(db, COLLECTION_NAME, UNIQUE_INDEX_NAME);
  await dropIndexIfExists(db, COLLECTION_NAME, PAGE_INDEX_NAME);
}
