import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';
import type {
  IDataWithRequiredMeta,
  IPage,
  IPageInfoBasic,
  IPageNotFoundInfo,
  IUser,
} from '@growi/core';
import { isIPageInfo, isIPageNotFoundInfo } from '@growi/core';
import {
  isPermalink as _isPermalink,
  isTopPage,
} from '@growi/core/dist/utils/page-path-utils';
import { removeHeadingSlash } from '@growi/core/dist/utils/path-utils';
import assert from 'assert';
import type { HydratedDocument, model } from 'mongoose';

import type { CrowiRequest } from '~/interfaces/crowi-request';
import type { PageDocument, PageModel } from '~/server/models/page';
import type {
  IPageRedirect,
  PageRedirectModel,
} from '~/server/models/page-redirect';
import { findPageAndMetaDataByViewer } from '~/server/service/page/find-page-and-meta-data-by-viewer';

import type { CommonEachProps } from '../common-props';
import type {
  GeneralPageInitialProps,
  IPageToShowRevisionWithMeta,
} from '../general-page';
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
    PageRedirect = mongooseModel<IPageRedirect, PageRedirectModel>(
      'PageRedirect',
    );
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
    const multiplePagesCount = await Page.countByPathAndViewer(
      resolvedPagePath,
      user,
      null,
      true,
    );
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
): Promise<
  GetServerSidePropsResult<
    Pick<GeneralPageInitialProps, 'pageWithMeta' | 'skipSSR'> &
      Pick<
        EachProps,
        'currentPathname' | 'isIdenticalPathPage' | 'redirectFrom'
      >
  >
> {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi, user } = req;
  const { revisionId } = req.query;

  // Parse path from URL
  let { path: pathFromQuery } = context.query;
  pathFromQuery = pathFromQuery != null ? (pathFromQuery as string[]) : [];
  let pathFromUrl = `/${pathFromQuery.join('/')}`;
  pathFromUrl = pathFromUrl === '//' ? '/' : pathFromUrl;

  const { pageService, pageGrantService, configManager } = crowi;

  const pageId = _isPermalink(pathFromUrl)
    ? removeHeadingSlash(pathFromUrl)
    : null;
  const isPermalink = _isPermalink(pathFromUrl);

  const { resolvedPagePath, isIdenticalPathPage, redirectFrom } =
    await resolvePathAndCheckIdentical(pathFromUrl, user);

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
  const pageWithMeta = await findPageAndMetaDataByViewer(
    pageService,
    pageGrantService,
    pageId,
    resolvedPagePath,
    user,
  );

  // Handle URL conversion
  const currentPathname = resolveFinalizedPathname(
    resolvedPagePath,
    pageWithMeta.data,
    isPermalink,
  );

  // When the page exists
  if (pageWithMeta.data != null) {
    const { data: page, meta } = pageWithMeta;

    // type assertion
    assert(isIPageInfo(meta), 'meta should be IPageInfo when data is not null');

    // Handle empty pages - return as not found to avoid serialization issues
    if (page.isEmpty) {
      return {
        props: {
          currentPathname,
          isIdenticalPathPage: false,
          pageWithMeta: {
            data: null,
            meta: {
              isNotFound: true,
              isForbidden: false,
            },
          } satisfies IDataWithRequiredMeta<null, IPageNotFoundInfo>,
          skipSSR: false,
          redirectFrom,
        },
      };
    }

    // Handle existing page with valid meta that is not IPageNotFoundInfo
    page.initLatestRevisionField(revisionId);
    const ssrMaxRevisionBodyLength = configManager.getConfig(
      'app:ssrMaxRevisionBodyLength',
    );

    // Check if SSR should be skipped
    const latestRevisionBodyLength = await page.getLatestRevisionBodyLength();
    const skipSSR =
      latestRevisionBodyLength != null &&
      ssrMaxRevisionBodyLength < latestRevisionBodyLength;

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
  assert(
    isIPageNotFoundInfo(pageWithMeta.meta),
    'meta should be IPageNotFoundInfo when data is null',
  );

  // Handle the case where the page does not exist
  return {
    props: {
      currentPathname: resolvedPagePath,
      isIdenticalPathPage: false,
      pageWithMeta: pageWithMeta satisfies IDataWithRequiredMeta<
        null,
        IPageNotFoundInfo
      >,
      skipSSR: false,
      redirectFrom,
    },
  };
}

// Page data retrieval for same-route navigation
export async function getPageDataForSameRoute(
  context: GetServerSidePropsContext,
): Promise<{
  props: Pick<CommonEachProps, 'currentPathname'> &
    Pick<EachProps, 'currentPathname' | 'isIdenticalPathPage' | 'redirectFrom'>;
  internalProps?: {
    pageWithMeta?:
      | IDataWithRequiredMeta<PageDocument, IPageInfoBasic>
      | IDataWithRequiredMeta<null, IPageNotFoundInfo>;
  };
}> {
  const req: CrowiRequest = context.req as CrowiRequest;
  const { crowi, user } = req;
  const { pageService, pageGrantService } = crowi;

  const pathname = decodeURIComponent(
    context.resolvedUrl?.split('?')[0] ?? '/',
  );
  const pageId = _isPermalink(pathname) ? removeHeadingSlash(pathname) : null;
  const isPermalink = _isPermalink(pathname);

  const { resolvedPagePath, isIdenticalPathPage, redirectFrom } =
    await resolvePathAndCheckIdentical(pathname, user);

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
  const pageWithMetaBasicOnly = await findPageAndMetaDataByViewer(
    pageService,
    pageGrantService,
    pageId,
    resolvedPagePath,
    user,
    false, // isSharedPage
    true, // basicOnly
  );

  const currentPathname = resolveFinalizedPathname(
    resolvedPagePath,
    pageWithMetaBasicOnly.data,
    isPermalink,
  );

  return {
    props: {
      currentPathname,
      isIdenticalPathPage: false,
      redirectFrom,
    },
    internalProps: {
      pageWithMeta: pageWithMetaBasicOnly.data?.isEmpty
        ? {
            data: null,
            meta: { isNotFound: true, isForbidden: false },
          }
        : pageWithMetaBasicOnly,
    },
  };
}
