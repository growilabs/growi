import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

import { configManager } from '~/server/service/config-manager';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:generate-service-instance-id');

export async function up(db) {
  logger.info('Generate serviceInstanceId for the system');
  await mongoose.connect(getMongoUri(), mongoOptions);

  await configManager.loadConfigs();

  await configManager.updateConfig('app:serviceInstanceId', uuidv4(), {
    skipPubsub: true,
  });
}

export async function down() {
  // No rollback
}
