import mongoose from 'mongoose';

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

export async function up(db) {
  logger.info('Apply migration');
  await mongoose.connect(getMongoUri(), mongoOptions);

  // Drop index
  await dropIndexIfExists(
    db,
    'vectorstorefilerelations',
    'vectorStoreRelationId_1_pageId_1',
  );

  // Rename field (pageId -> page)
  // Operate directly on the collection so this migration stays self-contained
  // and does not depend on the (deprecated) Mongoose model.
  await db
    .collection('vectorstorefilerelations')
    .updateMany({}, [{ $set: { page: '$pageId' } }, { $unset: ['pageId'] }]);

  // Create index
  const collection = mongoose.connection.collection('vectorstorefilerelations');
  await collection.createIndex(
    { vectorStoreRelationId: 1, page: 1 },
    { unique: true },
  );
}

export async function down() {
  // No rollback
}
