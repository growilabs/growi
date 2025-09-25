import { useEffect, useMemo } from 'react';

import type {
  Ref, Nullable,
  IPageInfoForEntity, IPagePopulatedToShowRevision,
  SWRInfinitePageRevisionsResponse,
  IPageInfo, IPageInfoForOperation,
  IRevision, IRevisionHasId,
} from '@growi/core';
import { useSWRStatic } from '@growi/core/dist/swr';
import { isClient, pagePathUtils } from '@growi/core/dist/utils';
import useSWR, {
  mutate, useSWRConfig, type SWRResponse, type SWRConfiguration,
} from 'swr';
import useSWRImmutable from 'swr/immutable';
import useSWRInfinite, { type SWRInfiniteResponse } from 'swr/infinite';
import useSWRMutation, { type SWRMutationResponse } from 'swr/mutation';

import { apiGet } from '~/client/util/apiv1-client';
import { apiv3Get } from '~/client/util/apiv3-client';
import type { IPagePathWithDescendantCount } from '~/interfaces/page';
import type { IRecordApplicableGrant, IResCurrentGrantData } from '~/interfaces/page-grant';
import {
  useCurrentPathname, useShareLinkId, useIsGuestUser, useIsReadOnlyUser,
} from '~/stores-universal/context';
import type { AxiosResponse } from '~/utils/axios';

import type { IPageTagsInfo } from '../interfaces/tag';


import { useRemoteRevisionId } from './remote-latest-page';


const { isPermalink: _isPermalink } = pagePathUtils;


export const useCurrentPageId = (initialData?: Nullable<string>): SWRResponse<Nullable<string>, Error> => {
  return useSWRStatic<Nullable<string>, Error>('currentPageId', initialData);
};

export const useIsLatestRevision = (initialData?: boolean): SWRResponse<boolean, any> => {
  return useSWRStatic('isLatestRevision', initialData);
};

export const useIsNotFound = (initialData?: boolean): SWRResponse<boolean, Error> => {
  return useSWRStatic<boolean, Error>('isNotFound', initialData, { fallbackData: false });
};

export const useTemplateTagData = (initialData?: string[]): SWRResponse<string[], Error> => {
  return useSWRStatic<string[], Error>('templateTagData', initialData);
};

export const useTemplateBodyData = (initialData?: string): SWRResponse<string, Error> => {
  return useSWRStatic<string, Error>('templateBodyData', initialData);
};

/** "useSWRxCurrentPage" is intended for initial data retrieval only. Use "useSWRMUTxCurrentPage" for revalidation */
export const useSWRxCurrentPage = (initialData?: IPagePopulatedToShowRevision | null): SWRResponse<IPagePopulatedToShowRevision | null> => {
  const key = 'currentPage';

  const { data: isLatestRevision } = useIsLatestRevision();

  const { cache } = useSWRConfig();

  // Problem 1: https://github.com/growilabs/growi/pull/7772/files#diff-4c1708c4f959974166c15435c6b35950ba01bbf35e7e4b8e99efeb125a8000a7
  // Problem 2: https://redmine.weseek.co.jp/issues/141027
  // Problem 3: https://redmine.weseek.co.jp/issues/153618
  // Problem 4: https://redmine.weseek.co.jp/issues/153759
  const shouldMutate = (() => {
    if (initialData === undefined) {
      return false;
    }

    // reset when null
    if (initialData == null) {
      return true;
    }

    const cachedData = cache.get(key)?.data as IPagePopulatedToShowRevision | null;
    if (initialData._id !== cachedData?._id) {
      return true;
    }

    // mutate when the empty page has updated
    if (cachedData?.revision == null && initialData.revision != null) {
      return true;
    }

    // mutate when opening a previous revision.
    if (!isLatestRevision
      && cachedData.revision?._id != null && initialData.revision?._id != null
      && cachedData.revision._id !== initialData.revision._id
    ) {
      return true;
    }

    return false;
  })();

  useEffect(() => {
    if (shouldMutate) {
      mutate(key, initialData, {
        optimisticData: initialData,
        populateCache: true,
        revalidate: false,
      });
    }
  }, [initialData, key, shouldMutate]);

  return useSWR(key, null, {
    keepPreviousData: true,
  });
};

const getPageApiErrorHandler = (errs: AxiosResponse[]) => {
  if (!Array.isArray(errs)) { throw Error('error is not array') }

  const statusCode = errs[0].status;
  if (statusCode === 403 || statusCode === 404) {
    // for NotFoundPage
    return null;
  }
  throw Error('failed to get page');
};

export const useSWRMUTxCurrentPage = (): SWRMutationResponse<IPagePopulatedToShowRevision | null> => {
  const key = 'currentPage';

  const { data: currentPageId } = useCurrentPageId();
  const { data: shareLinkId } = useShareLinkId();

  // Get URL parameter for specific revisionId
  let revisionId: string | undefined;
  if (isClient()) {
    const urlParams = new URLSearchParams(window.location.search);
    const requestRevisionId = urlParams.get('revisionId');
    revisionId = requestRevisionId != null ? requestRevisionId : undefined;
  }

  return useSWRMutation(
    key,
    () => apiv3Get<{ page: IPagePopulatedToShowRevision }>('/page', { pageId: currentPageId, shareLinkId, revisionId })
      .then((result) => {
        const newData = result.data.page;

        // for the issue https://redmine.weseek.co.jp/issues/156150
        mutate('currentPage', newData, false);

        return newData;
      })
      .catch(getPageApiErrorHandler),
    {
      populateCache: true,
      revalidate: false,
    },
  );
};

export const useSWRxPageByPath = (path?: string, config?: SWRConfiguration): SWRResponse<IPagePopulatedToShowRevision | null, Error> => {
  return useSWR(
    path != null ? ['/page', path] : null,
    ([endpoint, path]) => apiv3Get<{ page: IPagePopulatedToShowRevision }>(endpoint, { path })
      .then(result => result.data.page)
      .catch(getPageApiErrorHandler),
    {
      ...config,
      keepPreviousData: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
};

export const useSWRxTagsInfo = (pageId: Nullable<string>, config?: SWRConfiguration): SWRResponse<IPageTagsInfo | null, Error> => {
  const { data: shareLinkId } = useShareLinkId();

  const endpoint = `/pages.getPageTag?pageId=${pageId}`;

  return useSWR(
    shareLinkId == null && pageId != null ? [endpoint, pageId] : null,
    ([endpoint, pageId]) => apiGet<IPageTagsInfo>(endpoint, { pageId })
      .then(result => result)
      .catch(getPageApiErrorHandler),
    {
      ...config,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
};

export const mutateAllPageInfo = (): Promise<void[]> => {
  return mutate(
    key => Array.isArray(key) && key[0] === '/page/info',
  );
};

export const useSWRxPageInfo = (
    pageId: string | null | undefined,
    shareLinkId?: string | null,
    initialData?: IPageInfoForEntity,
): SWRResponse<IPageInfo | IPageInfoForOperation> => {

  // Cache remains from guest mode when logging in via the Login lead, so add 'isGuestUser' key
  const { data: isGuestUser } = useIsGuestUser();

  // assign null if shareLinkId is undefined in order to identify SWR key only by pageId
  const fixedShareLinkId = shareLinkId ?? null;

  const key = useMemo(() => {
    return pageId != null ? ['/page/info', pageId, fixedShareLinkId, isGuestUser] : null;
  }, [fixedShareLinkId, isGuestUser, pageId]);

  const swrResult = useSWRImmutable(
    key,
    ([endpoint, pageId, shareLinkId]: [string, string, string | null]) => apiv3Get(endpoint, { pageId, shareLinkId }).then(response => response.data),
    { fallbackData: initialData },
  );

  useEffect(() => {
    if (initialData !== undefined) {
      mutate(key, initialData, {
        optimisticData: initialData,
        populateCache: true,
        revalidate: false,
      });
    }
  }, [initialData, key]);

  return swrResult;
};

export const useSWRMUTxPageInfo = (
    pageId: string | null | undefined,
    shareLinkId?: string | null,
): SWRMutationResponse<IPageInfo | IPageInfoForOperation> => {

  // Cache remains from guest mode when logging in via the Login lead, so add 'isGuestUser' key
  const { data: isGuestUser } = useIsGuestUser();

  // assign null if shareLinkId is undefined in order to identify SWR key only by pageId
  const fixedShareLinkId = shareLinkId ?? null;

  const key = useMemo(() => {
    return pageId != null ? ['/page/info', pageId, fixedShareLinkId, isGuestUser] : null;
  }, [fixedShareLinkId, isGuestUser, pageId]);

  return useSWRMutation(
    key,
    ([endpoint, pageId, shareLinkId]: [string, string, string | null]) => apiv3Get(endpoint, { pageId, shareLinkId }).then(response => response.data),
  );
};

export const useSWRxPageRevision = (pageId: string, revisionId: Ref<IRevision>): SWRResponse<IRevisionHasId> => {
  const key = [`/revisions/${revisionId}`, pageId, revisionId];
  return useSWRImmutable(
    key,
    () => apiv3Get<{ revision: IRevisionHasId }>(`/revisions/${revisionId}`, { pageId }).then(response => response.data.revision),
  );
};

/*
 * SWR Infinite for page revision list
 */

export const useSWRxInfinitePageRevisions = (
    pageId: string,
    limit: number,
): SWRInfiniteResponse<SWRInfinitePageRevisionsResponse, Error> => {
  return useSWRInfinite(
    (pageIndex, previousRevisionData) => {
      if (previousRevisionData != null && previousRevisionData.revisions.length === 0) return null;

      if (pageIndex === 0 || previousRevisionData == null) {
        return ['/revisions/list', pageId, undefined, limit];
      }
      const offset = previousRevisionData.offset + limit;
      return ['/revisions/list', pageId, offset, limit];
    },
    ([endpoint, pageId, offset, limit]) => apiv3Get<SWRInfinitePageRevisionsResponse>(endpoint, { pageId, offset, limit }).then(response => response.data),
    {
      revalidateFirstPage: true,
      revalidateAll: false,
    },
  );
};

/*
 * Grant data fetching hooks
 */
export const useSWRxCurrentGrantData = (
    pageId: string | null | undefined,
): SWRResponse<IResCurrentGrantData, Error> => {

  const { data: isGuestUser } = useIsGuestUser();
  const { data: isReadOnlyUser } = useIsReadOnlyUser();
  const { data: isNotFound } = useIsNotFound();

  const key = !isGuestUser && !isReadOnlyUser && !isNotFound && pageId != null
    ? ['/page/grant-data', pageId]
    : null;

  return useSWR(
    key,
    ([endpoint, pageId]) => apiv3Get(endpoint, { pageId }).then(response => response.data),
  );
};

export const useSWRxApplicableGrant = (
    pageId: string | null | undefined,
): SWRResponse<IRecordApplicableGrant, Error> => {

  return useSWR(
    pageId != null ? ['/page/applicable-grant', pageId] : null,
    ([endpoint, pageId]) => apiv3Get(endpoint, { pageId }).then(response => response.data),
  );
};


/** **********************************************************
 *                     Computed states
 *********************************************************** */

export const useCurrentPagePath = (): SWRResponse<string | undefined, Error> => {
  const { data: currentPage } = useSWRxCurrentPage();
  const { data: currentPathname } = useCurrentPathname();

  return useSWRImmutable(
    ['currentPagePath', currentPage?.path, currentPathname],
    ([, , pathname]) => {
      if (currentPage?.path != null) {
        return currentPage.path;
      }
      if (pathname != null && !_isPermalink(pathname)) {
        return pathname;
      }
      return undefined;
    },
    // TODO: set fallbackData
    // { fallbackData:  }
  );
};

export const useIsTrashPage = (): SWRResponse<boolean, Error> => {
  const { data: pagePath } = useCurrentPagePath();

  return useSWRImmutable(
    pagePath == null ? null : ['isTrashPage', pagePath],
    ([, pagePath]) => pagePathUtils.isTrashPage(pagePath),
    // TODO: set fallbackData
    // { fallbackData:  }
  );
};

export const useIsRevisionOutdated = (): SWRResponse<boolean, Error> => {
  const { data: currentPage } = useSWRxCurrentPage();
  const { data: remoteRevisionId } = useRemoteRevisionId();

  const currentRevisionId = currentPage?.revision?._id;

  return useSWRImmutable(
    currentRevisionId != null && remoteRevisionId != null ? ['useIsRevisionOutdated', currentRevisionId, remoteRevisionId] : null,
    ([, remoteRevisionId, currentRevisionId]) => { return remoteRevisionId !== currentRevisionId },
  );
};


export const useSWRxPagePathsWithDescendantCount = (
    paths?: string[], userGroups?: string[], isIncludeEmpty?: boolean, includeAnyoneWithTheLink?: boolean,
): SWRResponse<IPagePathWithDescendantCount[], Error> => {
  return useSWR(
    (paths != null && paths.length !== 0) ? ['/page/page-paths-with-descendant-count', paths, userGroups, isIncludeEmpty, includeAnyoneWithTheLink] : null,
    ([endpoint, paths, userGroups, isIncludeEmpty, includeAnyoneWithTheLink]) => apiv3Get(
      endpoint, {
        paths, userGroups, isIncludeEmpty, includeAnyoneWithTheLink,
      },
    ).then(result => result.data.pagePathsWithDescendantCount),
  );
};
