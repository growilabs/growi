import assert from 'assert';

import type {
  IDataWithMeta, IPage, IPageNotFoundInfo, IUser,
} from '@growi/core/dist/interfaces';
import {
  isIPageInfo,
  isIPageNotFoundInfo,
} from '@growi/core/dist/interfaces';
import { isPermalink as _isPermalink, isTopPage } from '@growi/core/dist/utils/page-path-utils';
import { removeHeadingSlash } from '@growi/core/dist/utils/path-utils';
import type { model, HydratedDocument } from 'mongoose';
import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { PageModel } from '~/server/models/page';
import type { IPageRedirect, PageRedirectModel } from '~/server/models/page-redirect';

import type { CommonEachProps } from '../common-props';
import type { GeneralPageInitialProps, IPageToShowRevisionWithMeta } from '../general-page';

import type { EachProps } from './types';

// Utility to resolve path, redirect, and identical path page check
type PathResolutionResult = {
  resolvedPagePath: string;
  isIdenticalPathPage: boolean;
  redirectFrom?: string;
};

let mongooseModel: typeof model;
let Page: PageModel;
let PageRedirect: PageRedirectModel;

async function initModels(): Promise<void> {
  if (mongooseModel == null) {
    mongooseModel = (await import('mongoose')).model;
  }
  if (Page == null) {
    Page = mongooseModel<IPage, PageModel>('Page');
  }
  if (PageRedirect == null) {
    PageRedirect = mongooseModel<IPageRedirect, PageRedirectModel>('PageRedirect');
  }
}

async function resolvePathAndCheckIdentical(
    path: string,
    user: IUser | undefined,
): Promise<PathResolutionResult> {
  await initModels();

  const isPermalink = _isPermalink(path);
  let resolvedPagePath = path;
  let redirectFrom: string | undefined;
  let isIdenticalPathPage = false;

  if (!isPermalink) {
    const chains = await PageRedirect.retrievePageRedirectEndpoints(path);
    if (chains != null) {
      resolvedPagePath = chains.end.toPath;
      redirectFrom = chains.start.fromPath;
    }
    const multiplePagesCount = await Page.countByPathAndViewer(resolvedPagePath, user, null, true);
    isIdenticalPathPage = multiplePagesCount > 1;
  }
  return { resolvedPagePath, isIdenticalPathPage, redirectFrom };
}

/**
 * Convert pathname based on page data and permalink status
 * @returns Final pathname to be used in the URL
 */
function resolveFinalizedPathname(
    pagePath: string,
    page: HydratedDocument<IPage> | null | undefined,
    isPermalink: boolean,
): string {
  let finalPathname = pagePath;

  if (page != null) {
    // /62a88db47fed8b2d94f30000 ==> /path/to/page
    if (isPermalink && page.isEmpty) {
      finalPathname = page.path;
    }
    // /path/to/page ==> /62a88db47fed8b2d94f30000
    if (!isPermalink && !page.isEmpty) {
      const isToppage = isTopPage(pagePath);
      if (!isToppage && page._id) {
        finalPathname = `/${page._id.toString()}`;
      }
    }
  }

  return finalPathname;
}


// Page data retrieval for initial load - returns GetServerSidePropsResult
export async function getPageDataForInitial(
    context: GetServerSidePropsContext,
): Promise<GetServerSidePropsResult<
  Pick<GeneralPageInitialProps, 'pageWithMeta' | 'skipSSR'> &
  Pick<EachProps, 'currentPathname' | 'isIdenticalPathPage' | 'redirectFrom'>
>> {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi, user } = req;
  const { revisionId } = req.query;

  // Parse path from URL
  let { path: pathFromQuery } = context.query;
  pathFromQuery = pathFromQuery != null ? pathFromQuery as string[] : [];
  let pathFromUrl = `/${pathFromQuery.join('/')}`;
  pathFromUrl = pathFromUrl === '//' ? '/' : pathFromUrl;

  const { pageService, configManager } = crowi;

  const pageId = _isPermalink(pathFromUrl) ? removeHeadingSlash(pathFromUrl) : null;
  const isPermalink = _isPermalink(pathFromUrl);

  const { resolvedPagePath, isIdenticalPathPage, redirectFrom } = await resolvePathAndCheckIdentical(pathFromUrl, user);

  if (isIdenticalPathPage) {
    return {
      props: {
        currentPathname: resolvedPagePath,
        isIdenticalPathPage: true,
        pageWithMeta: null,
        skipSSR: false,
        redirectFrom,
      },
    };
  }

  // Get full page data
  const pageWithMeta = await pageService.findPageAndMetaDataByViewer(pageId, resolvedPagePath, user, true);

  // Handle URL conversion
  const currentPathname = resolveFinalizedPathname(resolvedPagePath, pageWithMeta.data, isPermalink);

  // When the page exists
  if (pageWithMeta.data != null) {
    const { data: page, meta } = pageWithMeta;

    // type assertion
    assert(isIPageInfo(meta), 'meta should be IPageInfo when data is not null');

    // Add user to seen users
    if (user != null) {
      await page.seen(user);
    }

    // Handle existing page with valid meta that is not IPageNotFoundInfo
    page.initLatestRevisionField(revisionId);
    const ssrMaxRevisionBodyLength = configManager.getConfig('app:ssrMaxRevisionBodyLength');

    // Check if SSR should be skipped
    const latestRevisionBodyLength = await page.getLatestRevisionBodyLength();
    const skipSSR = latestRevisionBodyLength != null && ssrMaxRevisionBodyLength < latestRevisionBodyLength;

    const populatedPage = await page.populateDataToShowRevision(skipSSR);

    return {
      props: {
        currentPathname,
        isIdenticalPathPage: false,
        pageWithMeta: {
          data: populatedPage,
          meta,
        } satisfies IPageToShowRevisionWithMeta,
        skipSSR,
        redirectFrom,
      },
    };
  }

  // type assertion
  assert(isIPageNotFoundInfo(pageWithMeta.meta), 'meta should be IPageNotFoundInfo when data is null');

  // Handle the case where the page does not exist
  return {
    props: {
      currentPathname: resolvedPagePath,
      isIdenticalPathPage: false,
      pageWithMeta: pageWithMeta satisfies IDataWithMeta<null, IPageNotFoundInfo>,
      skipSSR: false,
      redirectFrom,
    },
  };
}

// Page data retrieval for same-route navigation
export async function getPageDataForSameRoute(
    context: GetServerSidePropsContext,
): Promise<GetServerSidePropsResult<
    Pick<CommonEachProps, 'currentPathname'> &
    Pick<EachProps, 'currentPathname' | 'isIdenticalPathPage' | 'redirectFrom'>
>> {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { user } = req;

  const pathname = decodeURIComponent(context.resolvedUrl?.split('?')[0] ?? '/');
  const pageId = _isPermalink(pathname) ? removeHeadingSlash(pathname) : null;
  const isPermalink = _isPermalink(pathname);

  const { resolvedPagePath, isIdenticalPathPage, redirectFrom } = await resolvePathAndCheckIdentical(pathname, user);

  if (isIdenticalPathPage) {
    return {
      props: {
        currentPathname: resolvedPagePath,
        isIdenticalPathPage: true,
        redirectFrom,
      },
    };
  }

  // For same route access, do minimal page lookup
  const basicPageInfo = await Page.findOne(
    isPermalink ? { _id: pageId } : { path: resolvedPagePath },
  ).exec();

  const currentPathname = resolveFinalizedPathname(resolvedPagePath, basicPageInfo, isPermalink);

  return {
    props: {
      currentPathname,
      isIdenticalPathPage: false,
      redirectFrom,
    },
  };
}
