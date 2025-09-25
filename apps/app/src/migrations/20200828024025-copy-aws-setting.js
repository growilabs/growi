import mongoose from 'mongoose';

// eslint-disable-next-line import/no-named-as-default
import { Config } from '~/server/models/config';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:remove-layout-setting');

module.exports = {
  async up(db, client) {
    logger.info('Apply migration');
    await mongoose.connect(getMongoUri(), mongoOptions);

    const [accessKeyId, secretAccessKey] = await Promise.all([
      Config.findOne({ key: 'aws:accessKeyId' }),
      Config.findOne({ key: 'aws:secretAccessKey' }),
    ]);

    const request = [];

    if (accessKeyId != null) {
      if (accessKeyId.value != null) {
        request.push({
          insertOne: {
            document: {
              key: 'mail:sesAccessKeyId',
              value: accessKeyId.value,
            },
          },
        });
      }
    }

    if (secretAccessKey != null) {
      if (secretAccessKey.value != null) {
        request.push({
          insertOne: {
            document: {
              key: 'mail:sesSecretAccessKey',
              value: secretAccessKey.value,
            },
          },
        });
      }
    }

    if (request.length > 0) {
      await Config.bulkWrite(request);
    }

    logger.info('Migration has successfully applied');
  },

  async down(db, client) {
    logger.info('Rollback migration');
    await mongoose.connect(getMongoUri(), mongoOptions);

    await Config.deleteMany({
      key: { $in: ['mail:sesAccessKeyId', 'mail:sesSecretAccessKey'] },
    });

    logger.info('Migration has been successfully rollbacked');
  },
};
