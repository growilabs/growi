import mongoose from 'mongoose';

import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:migrate:add-revision-author-createdat-index',
);

export async function up(db) {
  logger.info('Apply migration');

  await mongoose.connect(getMongoUri(), mongoOptions);

  const collection = mongoose.connection.collection('revisions');
  await collection.createIndex(
    { author: 1, createdAt: -1 },
    { background: true },
  );

  logger.info(
    'Created compound index { author: 1, createdAt: -1 } on revisions',
  );
}

export async function down(db) {
  logger.info('Rollback migration');

  await mongoose.connect(getMongoUri(), mongoOptions);

  const collection = mongoose.connection.collection('revisions');

  // Find the index by key pattern and drop it
  const indexes = await collection.indexes();
  const idx = indexes.find(
    (i) => i.key && i.key.author === 1 && i.key.createdAt === -1,
  );
  if (idx) {
    await collection.dropIndex(idx.name);
    logger.info(`Dropped index ${idx.name} from revisions`);
  } else {
    logger.info(
      'Index { author: 1, createdAt: -1 } not found — nothing to drop',
    );
  }
}
