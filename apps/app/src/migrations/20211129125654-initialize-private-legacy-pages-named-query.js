import mongoose from 'mongoose';

import { SearchDelegatorName } from '~/interfaces/named-query.js';
import NamedQuery from '~/server/models/named-query.js';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils.js';
import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory(
  'growi:migrate:initialize-private-legacy-pages-named-query',
);

export async function up(db, next) {
  await mongoose.connect(getMongoUri(), mongoOptions);

  try {
    await NamedQuery.updateOne(
      { name: SearchDelegatorName.PRIVATE_LEGACY_PAGES },
      { delegatorName: SearchDelegatorName.PRIVATE_LEGACY_PAGES },
      { upsert: true },
    );
  } catch (err) {
    logger.error(
      'Failed to migrate named query for private legacy pages search delagator.',
      err,
    );
    throw err;
  }

  next();
  logger.info(
    'Successfully migrated named query for private legacy pages search delagator.',
  );
}

export async function down(db, next) {
  await mongoose.connect(getMongoUri(), mongoOptions);

  try {
    await NamedQuery.findOneAndDelete({
      name: SearchDelegatorName.PRIVATE_LEGACY_PAGES,
      delegatorName: SearchDelegatorName.PRIVATE_LEGACY_PAGES,
    });
  } catch (err) {
    logger.error(
      'Failed to delete named query for private legacy pages search delagator.',
      err,
    );
    throw err;
  }

  next();
  logger.info(
    'Successfully deleted named query for private legacy pages search delagator.',
  );
}
