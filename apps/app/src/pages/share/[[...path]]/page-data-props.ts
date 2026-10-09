import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';
import type { IPage, IPageHasId } from '@growi/core';
import {
  isUserPage,
  isUsersTopPage,
} from '@growi/core/dist/utils/page-path-utils';
import type { model } from 'mongoose';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { PageModel } from '~/server/models/page';
import { findPageAndMetaDataByViewer } from '~/server/service/page/find-page-and-meta-data-by-viewer';
import { prisma } from '~/utils/prisma';

import type { ShareLinkPageStatesProps } from './types';

let mongooseModel: typeof model;
let Page: PageModel;

const notFoundProps: GetServerSidePropsResult<ShareLinkPageStatesProps> = {
  props: {
    isNotFound: true,
    pageWithMeta: {
      data: null,
      meta: {
        isNotFound: true,
        isForbidden: false,
      },
    },
    isExpired: undefined,
    shareLink: undefined,
  },
};

export const getPageDataForInitial = async (
  context: GetServerSidePropsContext,
): Promise<GetServerSidePropsResult<ShareLinkPageStatesProps>> => {
  const req = context.req as CrowiRequest;
  const { crowi, params } = req;
  const { pageService, pageGrantService, configManager } = crowi;

  if (mongooseModel == null) {
    mongooseModel = (await import('mongoose')).model;
  }
  if (Page == null) {
    Page = mongooseModel<IPage, PageModel>('Page');
  }

  const shareLink = await prisma.sharelinks.findUnique({
    where: { id: params.linkId },
  });

  // not found
  if (shareLink == null) {
    return notFoundProps;
  }

  const pageId = shareLink.relatedPageId;
  const pageWithMeta = await findPageAndMetaDataByViewer(
    pageService,
    pageGrantService,
    { pageId, path: null, isSharedPage: true },
  );

  // not found
  if (pageWithMeta.data == null) {
    return notFoundProps;
  }

  // matches the shape previously produced by Mongoose's
  // `.populate('relatedPage')` + `.toObject()`
  const shareLinkForProps = {
    _id: shareLink.id,
    relatedPage: pageWithMeta.data.toObject() as IPageHasId,
    createdAt: shareLink.createdAt,
    expiredAt: shareLink.expiredAt ?? undefined,
    description: shareLink.description ?? '',
  };

  const disableUserPages = configManager.getConfig('security:disableUserPages');
  if (
    disableUserPages &&
    (isUserPage(pageWithMeta.data.path) ||
      isUsersTopPage(pageWithMeta.data.path))
  ) {
    return {
      props: {
        isNotFound: true,
        pageWithMeta: {
          data: null,
          meta: {
            isNotFound: true,
            isForbidden: true,
          },
        },
        isExpired: undefined,
        shareLink: undefined,
      },
    };
  }

  // expired
  if (shareLink.isExpired()) {
    const populatedPage =
      await pageWithMeta.data.populateDataToShowRevision(true); //shouldExcludeBody = false,
    return {
      props: {
        isNotFound: false,
        pageWithMeta: {
          data: populatedPage,
          meta: pageWithMeta.meta,
        },
        isExpired: true,
        shareLink: shareLinkForProps,
      },
    };
  }

  // Handle existing page
  const ssrMaxRevisionBodyLength = configManager.getConfig(
    'app:ssrMaxRevisionBodyLength',
  );

  // Check if SSR should be skipped
  const latestRevisionBodyLength =
    await pageWithMeta.data.getLatestRevisionBodyLength();
  const skipSSR =
    latestRevisionBodyLength != null &&
    ssrMaxRevisionBodyLength < latestRevisionBodyLength;

  // Populate page data for display
  const populatedPage =
    await pageWithMeta.data.populateDataToShowRevision(skipSSR);

  return {
    props: {
      isNotFound: false,
      pageWithMeta: {
        data: populatedPage,
        meta: pageWithMeta.meta,
      },
      skipSSR,
      isExpired: false,
      shareLink: shareLinkForProps,
    },
  };
};
