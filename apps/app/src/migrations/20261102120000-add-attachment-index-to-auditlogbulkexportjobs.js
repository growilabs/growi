import mongoose from 'mongoose';

import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:migrate:add-attachment-index-to-auditlogbulkexportjobs',
);

const COLLECTION_NAME = 'auditlogbulkexportjobs';
const INDEX_NAME = 'attachment_1';

export async function up() {
  logger.info('Apply migration');

  await mongoose.connect(getMongoUri(), mongoOptions);

  // Prisma's SetNull emulation runs updateMany filtered by `attachment` on every
  // attachment delete.
  // createIndex creates the collection if absent and is a no-op when the same index
  // already exists.
  await mongoose.connection
    .collection(COLLECTION_NAME)
    .createIndex({ attachment: 1 }, { name: INDEX_NAME });
}

export async function down() {
  logger.info('Rollback migration');

  await mongoose.connect(getMongoUri(), mongoOptions);

  const collection = mongoose.connection.collection(COLLECTION_NAME);
  if (await collection.indexExists(INDEX_NAME)) {
    await collection.dropIndex(INDEX_NAME);
  }
}
