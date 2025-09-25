import mongoose from 'mongoose';

// eslint-disable-next-line import/no-named-as-default
import { Config } from '~/server/models/config';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:abolish-crowi-classic-auth');

module.exports = {
  async up(db, next) {
    logger.info('Start migration');
    await mongoose.connect(getMongoUri(), mongoOptions);

    // enable passport and delete configs for crowi classic auth
    await Promise.all([
      Config.findOneAndUpdate(
        { key: 'security:isEnabledPassport' },
        { key: 'security:isEnabledPassport', value: JSON.stringify(true) },
        { upsert: true },
      ),
      Config.findOneAndUpdate(
        { key: 'google:clientId' },
        { key: 'google:clientId', value: JSON.stringify(null) },
        { upsert: true },
      ),
      Config.findOneAndUpdate(
        { key: 'google:clientSecret' },
        { key: 'google:clientSecret', value: JSON.stringify(null) },
        { upsert: true },
      ),
    ]);

    logger.info('Migration has successfully terminated');
    next();
  },

  async down(db, next) {
    // do not rollback
    next();
  },
};
