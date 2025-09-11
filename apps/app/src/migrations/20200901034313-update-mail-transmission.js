import mongoose from 'mongoose';

// eslint-disable-next-line import/no-named-as-default
import { Config } from '~/server/models/config';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:update-mail-transmission');

module.exports = {
  async up(db, client) {
    logger.info('Apply migration');
    await mongoose.connect(getMongoUri(), mongoOptions);

    const sesAccessKeyId = await Config.findOne({
      key: 'mail:sesAccessKeyId',
    });
    const transmissionMethod = await Config.findOne({
      key: 'mail:transmissionMethod',
    });

    if (sesAccessKeyId == null) {
      return logger.info(
        "The key 'mail:sesAccessKeyId' does not exist, value of transmission method will be set smtp automatically.",
      );
    }
    if (transmissionMethod != null) {
      return logger.info(
        "The key 'mail:transmissionMethod' already exists, there is no need to migrate.",
      );
    }

    const value =
      sesAccessKeyId.value != null
        ? JSON.stringify('ses')
        : JSON.stringify('smtp');

    await Config.create({
      ns: 'crowi',
      key: 'mail:transmissionMethod',
      value,
    });
    logger.info('Migration has successfully applied');
  },

  async down(db, client) {
    logger.info('Rollback migration');
    await mongoose.connect(getMongoUri(), mongoOptions);

    // remote 'mail:transmissionMethod'
    await Config.findOneAndDelete({
      key: 'mail:transmissionMethod',
    });

    logger.info('Migration has been successfully rollbacked');
  },
};
