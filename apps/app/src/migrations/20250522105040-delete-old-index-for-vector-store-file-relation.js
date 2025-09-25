import mongoose from 'mongoose';

import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:migrate:vector-store-file-relation-index-migration',
);

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

    // Drop old index
    await dropIndexIfExists(
      db,
      'vectorstorefilerelations',
      'vectorStoreRelationId_1_page_1',
    );

    // Create index
    const collection = mongoose.connection.collection(
      'vectorstorefilerelations',
    );
    await collection.createIndex(
      { vectorStoreRelationId: 1, page: 1, attachment: 1 },
      { unique: true },
    );
  },
  async down(db) {
    logger.info('Rollback migration');

    await mongoose.connect(getMongoUri(), mongoOptions);

    // Drop new index
    await dropIndexIfExists(
      db,
      'vectorstorefilerelations',
      'vectorStoreRelationId_1_page_1_attachment_1',
    );

    // Recreate old index
    const collection = mongoose.connection.collection(
      'vectorstorefilerelations',
    );
    await collection.createIndex(
      { vectorStoreRelationId: 1, page: 1 },
      { unique: true },
    );
  },
};
