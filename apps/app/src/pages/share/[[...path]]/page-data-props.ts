import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';
import type { IPage } from '@growi/core';
import { getIdForRef } from '@growi/core';
import type { model } from 'mongoose';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { IShareLink } from '~/interfaces/share-link';
import type { PageModel } from '~/server/models/page';
import type { ShareLinkModel } from '~/server/models/share-link';

import type { ShareLinkPageStatesProps } from './types';

let mongooseModel: typeof model;
let Page: PageModel;
let ShareLink: ShareLinkModel;

export const getPageDataForInitial = async (
  context: GetServerSidePropsContext,
): Promise<GetServerSidePropsResult<ShareLinkPageStatesProps>> => {
  const req = context.req as CrowiRequest;
  const { crowi, params } = req;

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
    return {
      props: {
        isNotFound: true,
        page: null,
        isExpired: undefined,
        shareLink: undefined,
      },
    };
  }

  // expired
  if (shareLink.isExpired()) {
    return {
      props: {
        isNotFound: false,
        page: null,
        isExpired: true,
        shareLink,
      },
    };
  }

  // retrieve Page
  const relatedPage = await Page.findOne({
    _id: getIdForRef(shareLink.relatedPage),
  });

  // not found
  if (relatedPage == null) {
    return {
      props: {
        isNotFound: true,
        page: null,
        isExpired: undefined,
        shareLink: undefined,
      },
    };
  }

  // Handle existing page
  const ssrMaxRevisionBodyLength = crowi.configManager.getConfig(
    'app:ssrMaxRevisionBodyLength',
  );

  // Check if SSR should be skipped
  const latestRevisionBodyLength =
    await relatedPage.getLatestRevisionBodyLength();
  const skipSSR =
    latestRevisionBodyLength != null &&
    ssrMaxRevisionBodyLength < latestRevisionBodyLength;

  const populatedPage = await relatedPage.populateDataToShowRevision(skipSSR);

  return {
    props: {
      isNotFound: false,
      page: populatedPage,
      skipSSR,
      isExpired: false,
      shareLink: shareLink.toObject(),
    },
  };
};
