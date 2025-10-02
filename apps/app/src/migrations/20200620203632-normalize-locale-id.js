import mongoose from 'mongoose';

import { Config } from '~/server/models/config';
import userModelFactory from '~/server/models/user';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:normalize-locale-id');

module.exports = {
  async up(db, client) {
    logger.info('Apply migration');
    await mongoose.connect(getMongoUri(), mongoOptions);

    const User = userModelFactory();

    await Promise.all([
      // update en-US -> en_US
      Config.update(
        { key: 'app:globalLang', value: JSON.stringify('en-US') },
        { value: JSON.stringify('en_US') },
      ),
      // update ja -> ja_JP
      Config.update(
        { key: 'app:globalLang', value: JSON.stringify('ja') },
        { value: JSON.stringify('ja_JP') },
      ),

      // update en-US -> en_US
      User.updateMany({ lang: 'en-US' }, { lang: 'en_US' }),
      // update ja -> ja_JP
      User.updateMany({ lang: 'ja' }, { lang: 'ja_JP' }),
    ]);

    logger.info('Migration has successfully applied');
  },

  async down(db, client) {
    // do not rollback
  },
};
