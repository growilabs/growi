import type { IPage } from '@growi/core';
import mongoose from 'mongoose';

import type { PageModel } from '~/server/models/page';

/**
 * Adapter passed to `InlineCommentService` as its `updateCommentCount`
 * dependency. The model is resolved per call, as `CommentService` does,
 * because `crowi.models.Page` is typed as a generic `Model<any>`.
 */
export const updatePageCommentCount = async (pageId: string): Promise<void> => {
  const Page = mongoose.model<IPage, PageModel>('Page');
  await Page.updateCommentCount(pageId);
};
