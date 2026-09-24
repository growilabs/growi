import type { IUser } from '@growi/core';
import type { Types } from 'mongoose';
import mongoose from 'mongoose';

import type { PageDocument, PageModel } from '~/server/models/page';

/**
 * Whether `user` may open the page `pageId` — the same answer a page view gets, so a
 * "can read" here never disagrees with what following the link does.
 *
 * Empty pages count as readable: they carry no body, and the backlinks panel still
 * renders on them.
 */
export const isPageReadableByViewer = async (
  pageId: Types.ObjectId,
  user: IUser | null,
): Promise<boolean> => {
  const Page = mongoose.model<PageDocument, PageModel>('Page');
  const count = await Page.countByIdAndViewer(pageId, user, null, true);
  return count > 0;
};
