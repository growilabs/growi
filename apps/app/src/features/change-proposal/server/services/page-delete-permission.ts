import type { IUserHasId } from '@growi/core';

import type { PageDocument } from '~/server/models/page';
import type { IPageService } from '~/server/service/page/page-service';

export type PageDeletePermissionService = Pick<
  IPageService,
  'getCreatorIdForCanDelete' | 'canDelete'
>;

// The same two calls the human delete route (routes/page.js) makes. A revert
// trashes one page without its children, so it is never recursive.
export const canTrashPage = async (
  pageService: PageDeletePermissionService,
  page: PageDocument,
  user: IUserHasId,
): Promise<boolean> => {
  const creatorId = await pageService.getCreatorIdForCanDelete(page);
  return pageService.canDelete(page, creatorId, user, false);
};
