import mongoose from 'mongoose';

import getPageModel from '~/server/models/page.js';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils.js';
import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory('growi:migrate:adjust-page-grant');

export async function up(db) {
  logger.info('Apply migration');
  await mongoose.connect(getMongoUri(), mongoOptions);

  const Page = getPageModel();

  await Page.bulkWrite([
    {
      updateMany: {
        filter: { grant: null },
        update: { $set: { grant: Page.GRANT_PUBLIC } },
      },
    },
  ]);

  logger.info('Migration has successfully applied');
}

export function down(db) {
  // do not rollback
}
