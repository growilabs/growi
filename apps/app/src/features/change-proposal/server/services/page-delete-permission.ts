import type { IUserHasId } from '@growi/core';
import { isUsersHomepage } from '@growi/core/dist/utils/page-path-utils';

import type { PageDocument } from '~/server/models/page';
import type { IPageService } from '~/server/service/page/page-service';
import type { IPageGrantService } from '~/server/service/page-grant';

export type PageDeletePermissionServices = {
  readonly pageService: Pick<
    IPageService,
    | 'getCreatorIdForCanDelete'
    | 'canDelete'
    | 'canDeleteCompletely'
    | 'canDeleteUserHomepageByConfig'
    | 'isUsersHomepageOwnerAbsent'
  >;
  readonly pageGrantService: Pick<IPageGrantService, 'getUserRelatedGroups'>;
};

export type CanDeletePageCompletely = (page: PageDocument) => Promise<boolean>;

/**
 * The checks the human complete-deletion route (routes/page.js) makes, plus
 * canDelete, which that route skips: a revert never removes more than a human
 * could. A revert deletes one page without its children, so never recursive.
 * The user's groups are read once for every page judged with the result.
 */
export const createCanDeletePageCompletely = async (
  { pageService, pageGrantService }: PageDeletePermissionServices,
  user: IUserHasId,
): Promise<CanDeletePageCompletely> => {
  const userRelatedGroups = await pageGrantService.getUserRelatedGroups(user);
  return async (page) => {
    const creatorId = await pageService.getCreatorIdForCanDelete(page);
    if (
      !pageService.canDelete(page, creatorId, user, false) ||
      !pageService.canDeleteCompletely(
        page,
        creatorId,
        user,
        false,
        userRelatedGroups,
      )
    ) {
      return false;
    }
    if (!isUsersHomepage(page.path)) {
      return true;
    }
    return (
      pageService.canDeleteUserHomepageByConfig() &&
      pageService.isUsersHomepageOwnerAbsent(page.path)
    );
  };
};
