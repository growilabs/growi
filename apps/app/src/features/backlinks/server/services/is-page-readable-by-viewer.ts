import type { IUser } from '@growi/core';
import type { Types } from 'mongoose';
import mongoose from 'mongoose';

import type { ObjectIdLike } from '~/server/interfaces/mongoose-utils';
import type { PageDocument, PageModel } from '~/server/models/page';

/**
 * Whether `user` may open the page `pageId` — the same answer a page view gets, so a
 * "can read" here never disagrees with what following the link does. That includes
 * `security:disableUserPages` hiding user pages.
 *
 * Empty pages count as readable: they carry no body, and the backlinks panel still
 * renders on them.
 *
 * `userGroups` is the viewer's group ids from `findUserGroupIdsForViewer`, resolved
 * once by the caller and shared with its other viewer-filtered reads.
 */
export const isPageReadableByViewer = (
  pageId: Types.ObjectId,
  user: IUser | null,
  userGroups: ObjectIdLike[] | null,
): Promise<boolean> => {
  const Page = mongoose.model<PageDocument, PageModel>('Page');
  return Page.isAccessiblePageByViewer(pageId, user, userGroups, true);
};
