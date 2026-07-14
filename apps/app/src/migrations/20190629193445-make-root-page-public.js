import mongoose from 'mongoose';

import getPageModel from '~/server/models/page';
import { getMongoUri, mongoOptions } from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:make-root-page-public');

export async function up(db) {
  logger.info('Apply migration');
  await mongoose.connect(getMongoUri(), mongoOptions);

  const Page = getPageModel();

  await Page.findOneAndUpdate(
    { path: '/' },
    {
      grant: Page.GRANT_PUBLIC,
      grantedUsers: [],
      grantedGroup: null,
    },
  );

  logger.info('Migration has successfully applied');
}

export function down(db) {
  // do not rollback
}
