import mongoose from 'mongoose';

import VectorStoreFileRelationModel from '~/features/openai/server/models/vector-store-file-relation';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:rename-pageId-to-page');

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

    // Drop index
    await dropIndexIfExists(
      db,
      'vectorstorefilerelations',
      'vectorStoreRelationId_1_pageId_1',
    );

    // Rename field (pageId -> page)
    await VectorStoreFileRelationModel.updateMany({}, [
      { $set: { page: '$pageId' } },
      { $unset: ['pageId'] },
    ]);

    // Create index
    const collection = mongoose.connection.collection(
      'vectorstorefilerelations',
    );
    await collection.createIndex(
      { vectorStoreRelationId: 1, page: 1 },
      { unique: true },
    );
  },

  async down() {
    // No rollback
  },
};
