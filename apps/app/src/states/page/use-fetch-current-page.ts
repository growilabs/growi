import { useCallback } from 'react';
import {
  type IPageNotFoundInfo,
  type IPagePopulatedToShowRevision,
  isIPageInfoForEmpty,
  isIPageNotFoundInfo,
} from '@growi/core/dist/interfaces';
import { isErrorV3 } from '@growi/core/dist/models';
import { isClient } from '@growi/core/dist/utils';
import { isPermalink } from '@growi/core/dist/utils/page-path-utils';
import { removeHeadingSlash } from '@growi/core/dist/utils/path-utils';
import { useAtomValue } from 'jotai';
import { useAtomCallback } from 'jotai/utils';

import { apiv3Get } from '~/client/util/apiv3-client';
import { useSWRxPageInfo } from '~/stores/page';
import loggerFactory from '~/utils/logger';

import {
  currentPageDataAtom,
  currentPageEmptyIdAtom,
  currentPageEntityIdAtom,
  isForbiddenAtom,
  pageErrorAtom,
  pageLoadingAtom,
  pageNotFoundAtom,
  remoteRevisionBodyAtom,
  revisionIdFromUrlAtom,
  shareLinkIdAtom,
} from './internal-atoms';

const logger = loggerFactory('growi:states:page:useFetchCurrentPage');

type FetchPageArgs = {
  path?: string;
  pageId?: string;
  revisionId?: string;
  force?: true;
};

type FetchedPageResult =
  | { page: IPagePopulatedToShowRevision; meta: unknown }
  | { page: null; meta: IPageNotFoundInfo };

/**
 * Process path to handle URL decoding and hash fragment removal
 *
 * Note: new URL().pathname re-encodes the path, so we decode it at the end
 * to ensure the final result is always decoded (e.g., "/path/にほんご")
 */
const decodeAndRemoveFragment = (pathname?: string): string | undefined => {
  if (pathname == null) return;

  try {
    const url = new URL(pathname, 'http://example.com');
    return decodeURIComponent(url.pathname);
  } catch {
    // Fallback to simple split if URL parsing fails
    const pathOnly = pathname.split('#')[0];
    try {
      return decodeURIComponent(pathOnly);
    } catch {
      return pathOnly;
    }
  }
};

/**
 * Check if cached data should be used to prevent unnecessary fetching
 */
const shouldUseCachedData = (
  args: FetchPageArgs | undefined,
  currentPageId: string | undefined,
  currentPageData: IPagePopulatedToShowRevision | undefined,
  decodedPathname?: string,
): boolean => {
  if (args?.force === true) {
    return false;
  }

  if (args?.revisionId != null) {
    if (args.revisionId !== currentPageData?.revision?._id) {
      return false;
    }
  }

  // Guard clause to prevent unnecessary fetching by pageId
  if (args?.pageId != null) {
    if (args.pageId !== currentPageId) {
      return false;
    }
  }

  // Guard clause to prevent unnecessary fetching by path
  if (decodedPathname != null) {
    if (
      isPermalink(decodedPathname) &&
      removeHeadingSlash(decodedPathname) !== currentPageId
    ) {
      return false;
    }
    if (decodedPathname !== currentPageData?.path) {
      return false;
    }
  }

  return true;
};

type BuildApiParamsArgs = {
  fetchPageArgs: Omit<FetchPageArgs, 'path'> | undefined;
  decodedPathname: string | undefined;
  currentPageId: string | undefined;
  shareLinkId: string | undefined;
  revisionIdFromUrl: string | undefined;
};
type ApiParams = { params: Record<string, string>; shouldSkip: boolean };

/**
 * Build API parameters for page fetching
 */
const buildApiParams = ({
  fetchPageArgs,
  decodedPathname,
  currentPageId,
  shareLinkId,
  revisionIdFromUrl,
}: BuildApiParamsArgs): ApiParams => {
  // Priority: explicit arg > URL query parameter
  const revisionId = fetchPageArgs?.revisionId ?? revisionIdFromUrl;

  const params: {
    path?: string;
    pageId?: string;
    revisionId?: string;
    shareLinkId?: string;
  } = {};

  if (shareLinkId != null) {
    params.shareLinkId = shareLinkId;
  }
  if (revisionId != null) {
    params.revisionId = revisionId;
  }

  // priority A: pageId > permalink > path
  if (fetchPageArgs?.pageId != null) {
    params.pageId = fetchPageArgs.pageId;
  } else if (decodedPathname != null) {
    if (isPermalink(decodedPathname)) {
      params.pageId = removeHeadingSlash(decodedPathname);
    } else {
      params.path = decodedPathname;
    }
    // priority B: currentPageId > permalink(by location) > path(by location)
  } else if (currentPageId != null) {
    params.pageId = currentPageId;
  } else if (isClient()) {
    try {
      params.path = decodeURIComponent(window.location.pathname);
    } catch {
      params.path = window.location.pathname;
    }
  } else {
    logger.warn(
      'Either path or pageId must be provided when not in a browser environment',
    );
    return { params, shouldSkip: true };
  }

  return { params, shouldSkip: false };
};

/**
 * Simplified page fetching hook using Jotai state management
 * All state is managed through atoms for consistent global state
 */
export const useFetchCurrentPage = (): {
  fetchCurrentPage: (
    args?: FetchPageArgs,
  ) => Promise<IPagePopulatedToShowRevision | null>;
  isLoading: boolean;
  error: Error | null;
} => {
  const shareLinkId = useAtomValue(shareLinkIdAtom);
  const currentPageId = useAtomValue(currentPageEntityIdAtom);

  const isLoading = useAtomValue(pageLoadingAtom);
  const error = useAtomValue(pageErrorAtom);

  const { mutate: mutatePageInfo } = useSWRxPageInfo(
    currentPageId,
    shareLinkId,
  );

  const fetchCurrentPage = useAtomCallback(
    useCallback(
      async (
        get,
        set,
        args?: FetchPageArgs,
      ): Promise<IPagePopulatedToShowRevision | null> => {
        const currentPageId = get(currentPageEntityIdAtom);
        const currentPageData = get(currentPageDataAtom);
        const revisionIdFromUrl = get(revisionIdFromUrlAtom);

        // Process path first to handle permalinks and strip hash fragments
        const decodedPathname = decodeAndRemoveFragment(args?.path);

        // Guard clause to prevent unnecessary fetching
        if (
          shouldUseCachedData(
            args,
            currentPageId,
            currentPageData,
            decodedPathname,
          )
        ) {
          return currentPageData ?? null;
        }

        set(pageLoadingAtom, true);
        set(pageErrorAtom, null);
        set(pageNotFoundAtom, false);

        // Build API parameters
        const { params, shouldSkip } = buildApiParams({
          fetchPageArgs: args,
          decodedPathname,
          currentPageId,
          shareLinkId,
          revisionIdFromUrl,
        });

        if (shouldSkip) {
          set(pageLoadingAtom, false);
          return null;
        }

        try {
          const { data } = await apiv3Get<FetchedPageResult>('/page', params);
          const { page: newData, meta } = data;

          console.log('Fetched page data:', { newData, meta });

          set(currentPageDataAtom, newData ?? undefined);
          set(currentPageEntityIdAtom, newData?._id);
          set(
            currentPageEmptyIdAtom,
            isIPageInfoForEmpty(meta) ? meta.emptyPageId : undefined,
          );
          set(pageNotFoundAtom, isIPageNotFoundInfo(meta));
          set(
            isForbiddenAtom,
            isIPageNotFoundInfo(meta) ? (meta.isForbidden ?? false) : false,
          );

          // Mutate PageInfo to refetch latest metadata including latestRevisionId
          mutatePageInfo();

          return newData;
        } catch (err) {
          if (!Array.isArray(err) || err.length === 0) {
            set(pageErrorAtom, new Error('Unknown error'));
            logger.error('Unhandled error when fetching current page:', err);
            return null;
          }

          const error = err[0];
          if (isErrorV3(error)) {
            set(pageErrorAtom, error);

            if (isIPageNotFoundInfo(error.args)) {
              set(pageNotFoundAtom, true);
              set(isForbiddenAtom, error.args.isForbidden ?? false);
              set(currentPageDataAtom, undefined);
              set(currentPageEntityIdAtom, undefined);
              set(currentPageEmptyIdAtom, undefined);
              set(remoteRevisionBodyAtom, undefined);
            }
          }
        } finally {
          set(pageLoadingAtom, false);
        }

        return null;
      },
      [shareLinkId, mutatePageInfo],
    ),
  );

  return { fetchCurrentPage, isLoading, error };
};
