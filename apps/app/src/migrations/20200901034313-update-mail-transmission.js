import mongoose from 'mongoose';

import { Config } from '~/server/models/config.js';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils.js';
import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory('growi:migrate:update-mail-transmission');

export async function up(db, client) {
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
}

export async function down(db, client) {
  logger.info('Rollback migration');
  await mongoose.connect(getMongoUri(), mongoOptions);

  // remote 'mail:transmissionMethod'
  await Config.findOneAndDelete({
    key: 'mail:transmissionMethod',
  });

  logger.info('Migration has been successfully rollbacked');
}
