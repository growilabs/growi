import mongoose from 'mongoose';

import { Config } from '~/server/models/config';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:init-serverurl');

/**
 * check all values of the array are equal
 * @see https://stackoverflow.com/a/35568895
 */
function isAllValuesSame(array) {
  return !!array.reduce((a, b) => {
    return a === b ? a : NaN;
  });
}

module.exports = {
  async up(db) {
    logger.info('Apply migration');
    await mongoose.connect(getMongoUri(), mongoOptions);

    // find 'app:siteUrl'
    const siteUrlConfig = await Config.findOne({
      key: 'app:siteUrl',
    });
    // exit if exists
    if (siteUrlConfig != null) {
      logger.info(
        "'app:siteUrl' is already exists. This migration terminates without any changes.",
      );
      return;
    }

    // find all callbackUrls
    const configs = await Config.find({
      $or: [
        { key: 'security:passport-github:callbackUrl' },
        { key: 'security:passport-google:callbackUrl' },
        { key: 'security:passport-saml:callbackUrl' },
      ],
    });

    // determine serverUrl
    let siteUrl;
    if (configs.length > 0) {
      logger.info(`${configs.length} configs which has callbackUrl found: `);
      logger.info(configs);

      // extract domain
      const siteUrls = configs
        .map((config) => {
          // see https://regex101.com/r/Q0Isjo/2
          const match = config.value.match(/^"(https?:\/\/[^/]+).*"$/);
          return match != null ? match[1] : null;
        })
        .filter((value) => {
          return value != null;
        });

      // determine serverUrl if all values are same
      if (siteUrls.length > 0 && isAllValuesSame(siteUrls)) {
        siteUrl = siteUrls[0];
      }
    }

    if (siteUrl != null) {
      const key = 'app:siteUrl';
      await Config.findOneAndUpdate(
        { key },
        { key, value: JSON.stringify(siteUrl) },
        { upsert: true },
      );
      logger.info('Migration has successfully applied');
    }
  },

  async down(db) {
    logger.info('Rollback migration');
    await mongoose.connect(getMongoUri(), mongoOptions);

    // remote 'app:siteUrl'
    await Config.findOneAndDelete({
      key: 'app:siteUrl',
    });

    logger.info('Migration has been successfully rollbacked');
  },
};
