import mongoose from 'mongoose';

import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:drop-configs-indices');

async function dropIndexIfExists(collection, indexName) {
  if (await collection.indexExists(indexName)) {
    await collection.dropIndex(indexName);
  }
}

module.exports = {
  async up(db) {
    logger.info('Apply migration');
    await mongoose.connect(getMongoUri(), mongoOptions);

    const collection = db.collection('configs');
    await dropIndexIfExists(collection, 'ns_1');
    await dropIndexIfExists(collection, 'key_1');

    logger.info('Migration has successfully applied');
  },

  down(db) {
    // do not rollback
  },
};
