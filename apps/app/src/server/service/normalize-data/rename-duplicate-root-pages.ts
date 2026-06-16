// see: https://github.com/growilabs/growi/issues/8337

import type { IPageHasId } from '@growi/core';
import mongoose from 'mongoose';

import type { PageModel } from '~/server/models/page';

export const renameDuplicateRootPages = async (): Promise<void> => {
  const Page = mongoose.model<IPageHasId, PageModel>('Page');
  const rootPages = await Page.find({ path: '/' }).sort({ createdAt: 1 });

  if (rootPages.length <= 1) {
    return;
  }

  const duplicatedRootPages = rootPages.slice(1);
  const requests = duplicatedRootPages.map((page) => {
    return {
      updateOne: {
        filter: { _id: page._id },
        update: {
          $set: {
            parent: rootPages[0],
            path: `/obsolete-root-page-${page._id.toString()}`,
          },
        },
      },
    };
  });
  await Page.bulkWrite(requests);
};
