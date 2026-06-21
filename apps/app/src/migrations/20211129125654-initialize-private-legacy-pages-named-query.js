import mongoose from 'mongoose';

import { SearchDelegatorName } from '~/interfaces/named-query';
import NamedQuery from '~/server/models/named-query';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:migrate:initialize-private-legacy-pages-named-query',
);

module.exports = {
  async up(db, next) {
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
  },

  async down(db, next) {
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
  },
};
