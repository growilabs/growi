import mongoose from 'mongoose';

import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:migrate:add-index-to-pagebulkexportpagesnapshots',
);

const COLLECTION_NAME = 'pagebulkexportpagesnapshots';
const INDEX_NAME = 'pageBulkExportJob_1_path_1__id_1';

export async function up() {
  logger.info('Apply migration');

  await mongoose.connect(getMongoUri(), mongoOptions);

  // Serves the keyset-paginated export read ordered by (path, _id), the deleteMany by
  // job, and the pdf-converter's last-path lookup.
  // createIndex creates the collection if absent and is a no-op when the same index
  // already exists.
  await mongoose.connection
    .collection(COLLECTION_NAME)
    .createIndex({ pageBulkExportJob: 1, path: 1, _id: 1 }, { name: INDEX_NAME });
}

export async function down() {
  logger.info('Rollback migration');

  await mongoose.connect(getMongoUri(), mongoOptions);

  const collection = mongoose.connection.collection(COLLECTION_NAME);
  if (await collection.indexExists(INDEX_NAME)) {
    await collection.dropIndex(INDEX_NAME);
  }
}
