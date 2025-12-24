import type {
  IDataWithRequiredMeta,
  IPageInfo,
  IPageInfoBasic,
  IPageInfoExt,
  IPageInfoForEmpty,
  IPageInfoForOperation,
  IPageNotFoundInfo,
  IUser,
} from '@growi/core/dist/interfaces';
import { isIPageInfoForEntity } from '@growi/core/dist/interfaces';
import { pagePathUtils } from '@growi/core/dist/utils';
import assert from 'assert';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import type { BookmarkedPage } from '~/interfaces/bookmark-info';
import type { PageDocument, PageModel } from '~/server/models/page';
import type { IPageGrantService } from '~/server/service/page-grant';

import Subscription from '../../models/subscription';
import type { IPageService } from './page-service';

// Overload: basicOnly = true returns basic info only
export async function findPageAndMetaDataByViewer(
  pageService: IPageService,
  pageGrantService: IPageGrantService,
  pageId: string | null,
  path: string | null,
  user: HydratedDocument<IUser> | undefined,
  isSharedPage: boolean,
  basicOnly: true,
): Promise<
  | IDataWithRequiredMeta<HydratedDocument<PageDocument>, IPageInfoBasic>
  | IDataWithRequiredMeta<null, IPageNotFoundInfo>
>;

// Overload: basicOnly = false or undefined returns extended info
export async function findPageAndMetaDataByViewer(
  pageService: IPageService,
  pageGrantService: IPageGrantService,
  pageId: string | null,
  path: string | null,
  user?: HydratedDocument<IUser>,
  isSharedPage?: boolean,
  basicOnly?: false,
): Promise<
  | IDataWithRequiredMeta<HydratedDocument<PageDocument>, IPageInfoExt>
  | IDataWithRequiredMeta<null, IPageNotFoundInfo>
>;

// Implementation
export async function findPageAndMetaDataByViewer(
  pageService: IPageService,
  pageGrantService: IPageGrantService,

  pageId: string | null, // either pageId or path must be specified
  path: string | null, // either pageId or path must be specified
  user?: HydratedDocument<IUser>,
  isSharedPage = false,
  basicOnly = false,
): Promise<
  | IDataWithRequiredMeta<
      HydratedDocument<PageDocument>,
      IPageInfoExt | IPageInfoBasic
    >
  | IDataWithRequiredMeta<null, IPageNotFoundInfo>
> {
  assert(pageId != null || path != null);

  const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
    'Page',
  );

  let page: HydratedDocument<PageDocument> | null;
  if (pageId != null) {
    // prioritized
    page = await Page.findByIdAndViewer(pageId, user, null, true);
  } else {
    page = await Page.findByPathAndViewer(path, user, null, true, true);
  }

  // not found or forbidden
  if (page == null) {
    const count =
      pageId != null
        ? await Page.count({ _id: { $eq: pageId } })
        : await Page.count({ path: { $eq: path } });
    const isForbidden = count > 0;
    return {
      data: null,
      meta: {
        isNotFound: true,
        isForbidden,
      } satisfies IPageNotFoundInfo,
    };
  }

  const isGuestUser = user == null;
  const basicPageInfo = pageService.constructBasicPageInfo(page, isGuestUser);

  // Return basic info only without additional DB queries and calculations
  if (basicOnly) {
    return {
      data: page,
      meta: basicPageInfo,
    };
  }

  if (isSharedPage) {
    return {
      data: page,
      meta: {
        ...basicPageInfo,
        isMovable: false,
        isDeletable: false,
        isAbleToDeleteCompletely: false,
        isRevertible: false,
        bookmarkCount: 0,
      } satisfies IPageInfo,
    };
  }

  const Bookmark = mongoose.model<
    BookmarkedPage,
    { countDocuments; findByPageIdAndUserId }
  >('Bookmark');
  const bookmarkCount: number = await Bookmark.countDocuments({
    page: { $eq: pageId },
  });

  const pageInfo = {
    ...basicPageInfo,
    bookmarkCount,
  };

  if (isGuestUser) {
    return {
      data: page,
      meta: {
        ...pageInfo,
        isDeletable: false,
        isAbleToDeleteCompletely: false,
      } satisfies IPageInfo,
    };
  }

  const creatorId = await pageService.getCreatorIdForCanDelete(page);

  const userRelatedGroups = await pageGrantService.getUserRelatedGroups(user);

  const canDeleteUserHomepage = await (async () => {
    // Not a user homepage
    if (!pagePathUtils.isUsersHomepage(page.path)) {
      return true;
    }

    if (!pageService.canDeleteUserHomepageByConfig()) {
      return false;
    }

    return await pageService.isUsersHomepageOwnerAbsent(page.path);
  })();

  const isDeletable =
    canDeleteUserHomepage &&
    pageService.canDelete(page, creatorId, user, false);

  const isAbleToDeleteCompletely =
    canDeleteUserHomepage &&
    pageService.canDeleteCompletely(
      page,
      creatorId,
      user,
      false,
      userRelatedGroups,
    ); // use normal delete config

  const isBookmarked: boolean = isGuestUser
    ? false
    : (await Bookmark.findByPageIdAndUserId(pageId, user._id)) != null;

  if (pageInfo.isEmpty) {
    return {
      data: page,
      meta: {
        ...pageInfo,
        isDeletable,
        isAbleToDeleteCompletely,
        isBookmarked,
      } satisfies IPageInfoForEmpty,
    };
  }

  // IPageInfoForEmpty and IPageInfoForEntity are mutually exclusive
  // so hereafter we can safely
  assert(isIPageInfoForEntity(pageInfo));

  const isLiked: boolean = page.isLiked(user);
  const subscription = await Subscription.findByUserIdAndTargetId(
    user._id,
    page._id,
  );

  return {
    data: page,
    meta: {
      ...pageInfo,
      isDeletable,
      isAbleToDeleteCompletely,
      isBookmarked,
      isLiked,
      subscriptionStatus: subscription?.status,
    } satisfies IPageInfoForOperation,
  };
}
