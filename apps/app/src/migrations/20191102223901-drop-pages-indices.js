import mongoose from 'mongoose';

import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:drop-pages-indices');

async function dropIndexIfExists(db, collectionName, indexName) {
  // check existence of the collection
  const items = await db
    .listCollections({ name: collectionName }, { nameOnly: true })
    .toArray();
  if (items.length === 0) {
    return;
  }

  const collection = await db.collection(collectionName);
  if (await collection.indexExists(indexName)) {
    await collection.dropIndex(indexName);
  }
}

module.exports = {
  async up(db) {
    logger.info('Apply migration');
    await mongoose.connect(getMongoUri(), mongoOptions);

    await dropIndexIfExists(db, 'pages', 'lastUpdateUser_1');
    await dropIndexIfExists(db, 'pages', 'liker_1');
    await dropIndexIfExists(db, 'pages', 'seenUsers_1');

    logger.info('Migration has successfully applied');
  },

  down(db) {
    // do not rollback
  },
};
