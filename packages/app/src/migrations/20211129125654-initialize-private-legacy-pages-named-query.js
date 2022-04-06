import mongoose from 'mongoose';

import { getModelSafely, getMongoUri, mongoOptions } from '@growi/core';
import NamedQuery from '~/server/models/named-query';
import { SearchDelegatorName } from '~/interfaces/named-query';
import loggerFactory from '~/utils/logger';


const logger = loggerFactory('growi:migrate:initialize-private-legacy-pages-named-query');

module.exports = {
  async up(db, next) {
    mongoose.connect(getMongoUri(), mongoOptions);

    try {
      await NamedQuery.insertMany({
        name: SearchDelegatorName.PRIVATE_LEGACY_PAGES,
        delegatorName: SearchDelegatorName.PRIVATE_LEGACY_PAGES,
      });
    }
    catch (err) {
      logger.error('Failed to migrate named query for private legacy pages search delagator.', err);
      throw err;
    }

    next();
    logger.info('Successfully migrated named query for private legacy pages search delagator.');
  },

  async down(db, next) {
    mongoose.connect(getMongoUri(), mongoOptions);

    try {
      await NamedQuery.findOneAndDelete({
        name: SearchDelegatorName.PRIVATE_LEGACY_PAGES,
        delegatorName: SearchDelegatorName.PRIVATE_LEGACY_PAGES,
      });
    }
    catch (err) {
      logger.error('Failed to delete named query for private legacy pages search delagator.', err);
      throw err;
    }

    next();
    logger.info('Successfully deleted named query for private legacy pages search delagator.');
  },
};
