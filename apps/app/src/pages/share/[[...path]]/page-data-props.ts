import { getIdForRef } from '@growi/core';
import type { IPage } from '@growi/core';
import type { model } from 'mongoose';
import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { IShareLink } from '~/interfaces/share-link';
import type { PageModel } from '~/server/models/page';
import type { ShareLinkModel } from '~/server/models/share-link';

import type { InitialProps } from '../../general-page';

import type { ShareLinkPageProps } from './types';


let mongooseModel: typeof model;
let Page: PageModel;
let ShareLink: ShareLinkModel;

export const getPageDataForInitial = async(context: GetServerSidePropsContext):
    Promise<GetServerSidePropsResult<Pick<InitialProps, 'isNotFound' | 'pageWithMeta' | 'skipSSR'> & ShareLinkPageProps>> => {

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

  const shareLink = await ShareLink.findOne({ _id: params.linkId }).populate('relatedPage');

  // not found
  if (shareLink == null) {
    return {
      props: {
        isNotFound: true,
        pageWithMeta: null,
      },
    };
  }

  // expired
  if (shareLink.isExpired()) {
    return {
      props: {
        isNotFound: false,
        pageWithMeta: null,
        isExpired: true,
      },
    };
  }

  // retrieve Page
  const relatedPage = await Page.findOne({ _id: getIdForRef(shareLink.relatedPage) });

  // not found
  if (relatedPage == null) {
    return {
      props: {
        isNotFound: true,
        pageWithMeta: null,
      },
    };
  }

  // Handle existing page
  const ssrMaxRevisionBodyLength = crowi.configManager.getConfig('app:ssrMaxRevisionBodyLength');

  // Check if SSR should be skipped
  const latestRevisionBodyLength = await relatedPage.getLatestRevisionBodyLength();
  const skipSSR = latestRevisionBodyLength != null && ssrMaxRevisionBodyLength < latestRevisionBodyLength;

  const populatedPage = await relatedPage.populateDataToShowRevision(skipSSR);

  return {
    props: {
      isNotFound: false,
      pageWithMeta: { data: populatedPage },
      skipSSR,
      isExpired: false,
      shareLink: shareLink.toObject(),
    },
  };
};
