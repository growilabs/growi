import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';
import type { IPage } from '@growi/core';
import { getIdStringForRef } from '@growi/core';
import type { model } from 'mongoose';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { IShareLink } from '~/interfaces/share-link';
import type { PageModel } from '~/server/models/page';
import type { ShareLinkModel } from '~/server/models/share-link';

import type { ShareLinkPageStatesProps } from './types';

let mongooseModel: typeof model;
let Page: PageModel;
let ShareLink: ShareLinkModel;

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
  const { pageService, configManager } = crowi;

  if (mongooseModel == null) {
    mongooseModel = (await import('mongoose')).model;
  }
  if (Page == null) {
    Page = mongooseModel<IPage, PageModel>('Page');
  }
  if (ShareLink == null) {
    ShareLink = mongooseModel<IShareLink, ShareLinkModel>('ShareLink');
  }

  const shareLink = await ShareLink.findOne({ _id: params.linkId }).populate(
    'relatedPage',
  );

  // not found
  if (shareLink == null) {
    return notFoundProps;
  }

  const pageId = getIdStringForRef(shareLink.relatedPage);
  const pageWithMeta = await pageService.findPageAndMetaDataByViewer(
    pageId,
    null,
    undefined, // no user for share link
    true, // isSharedPage
  );

  // not found
  if (pageWithMeta.data == null) {
    return notFoundProps;
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
        shareLink: shareLink.toObject(),
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
      shareLink: shareLink.toObject(),
    },
  };
};
