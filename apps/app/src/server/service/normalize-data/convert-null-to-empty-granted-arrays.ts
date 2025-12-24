import type { IPageHasId } from '@growi/core';
import mongoose from 'mongoose';

import type { PageModel } from '~/server/models/page';

export const convertNullToEmptyGrantedArrays = async (): Promise<void> => {
  const Page = mongoose.model<IPageHasId, PageModel>('Page');

  const requests = [
    {
      updateMany: {
        // Matches documents where field is null or nonexistent
        // https://www.mongodb.com/docs/manual/tutorial/query-for-null-fields/#equality-filter
        filter: { grantedUsers: null },
        update: {
          $set: { grantedUsers: [] },
        },
      },
    },
    {
      updateMany: {
        filter: { grantedGroups: null },
        update: {
          $set: { grantedGroups: [] },
        },
      },
    },
  ];

  await Page.bulkWrite(requests);
};
