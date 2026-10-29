import type { IUser } from '@growi/core';
import { isIPageNotFoundInfo } from '@growi/core';
import type { HydratedDocument } from 'mongoose';

import { findPageAndMetaDataByViewer } from '~/server/service/page/find-page-and-meta-data-by-viewer';
import type { IPageService } from '~/server/service/page/page-service';
import type { IPageGrantService } from '~/server/service/page-grant';

type CanViewCommentsOfPageDeps = {
  readonly pageService: IPageService;
  readonly pageGrantService: IPageGrantService;
};

type CanViewCommentsOfPageInput = {
  readonly req: {
    readonly user?: HydratedDocument<IUser>;
    readonly isSharedPage?: boolean;
  };
  readonly pageId: string;
};

/**
 * Whether the requester may read the comments of `pageId`: via a valid share
 * link, or by being allowed to view the page.
 *
 * Trusts only the `isSharedPage` flag set by certifySharedPage, which verified
 * that the share link belongs to this page; never a raw shareLinkId.
 */
export const canViewCommentsOfPage = async (
  { pageService, pageGrantService }: CanViewCommentsOfPageDeps,
  { req, pageId }: CanViewCommentsOfPageInput,
): Promise<boolean> => {
  if (req.isSharedPage === true) {
    return true;
  }
  const { meta } = await findPageAndMetaDataByViewer(
    pageService,
    pageGrantService,
    { pageId, path: null, user: req.user, basicOnly: true },
  );
  return !isIPageNotFoundInfo(meta);
};
