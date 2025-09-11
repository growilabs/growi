import mongoose from 'mongoose';

import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:remove-index-for-ns-from-configs');

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

    // remove unnecessary data
    // see: https://redmine.weseek.co.jp/issues/163527
    await db.collection('configs').deleteMany({
      ns: 'crowi',
      key: {
        $in: [
          'notification:owner-page:isEnabled',
          'notification:group-page:isEnabled',
        ],
      },
    });

    // drop index
    await dropIndexIfExists(db, 'configs', 'ns_1_key_1');

    // create index
    const collection = await db.collection('configs');
    await collection.createIndex({ key: 1 }, { unique: true });
  },

  async down() {
    // No rollback
  },
};
