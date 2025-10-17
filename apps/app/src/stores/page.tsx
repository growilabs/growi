import { useEffect, useMemo } from 'react';

import type {
  Ref, Nullable,
  IPageInfoForEntity, IPagePopulatedToShowRevision,
  SWRInfinitePageRevisionsResponse,
  IPageInfo, IPageInfoForOperation,
  IRevision, IRevisionHasId,
} from '@growi/core';
import useSWR, {
  mutate, type SWRResponse, type SWRConfiguration,
} from 'swr';
import useSWRImmutable from 'swr/immutable';
import useSWRInfinite, { type SWRInfiniteResponse } from 'swr/infinite';
import useSWRMutation, { type SWRMutationResponse } from 'swr/mutation';

import { apiGet } from '~/client/util/apiv1-client';
import { apiv3Get } from '~/client/util/apiv3-client';
import type { IPagePathWithDescendantCount } from '~/interfaces/page';
import type { IRecordApplicableGrant, IResCurrentGrantData } from '~/interfaces/page-grant';
import { useIsGuestUser, useIsReadOnlyUser } from '~/states/context';
import { usePageNotFound } from '~/states/page';
import { useShareLinkId } from '~/states/page/hooks';
import type { AxiosResponse } from '~/utils/axios';

import type { IPageTagsInfo } from '../interfaces/tag';


const getPageApiErrorHandler = (errs: AxiosResponse[]) => {
  if (!Array.isArray(errs)) { throw Error('error is not array') }

  const statusCode = errs[0].status;
  if (statusCode === 403 || statusCode === 404) {
    // for NotFoundPage
    return null;
  }
  throw Error('failed to get page');
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
  const shareLinkId = useShareLinkId();

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
  const isGuestUser = useIsGuestUser();

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
  const isGuestUser = useIsGuestUser();

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

  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();
  const isNotFound = usePageNotFound();

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
 *                     @deprecated Use enhanced versions from ~/states/page instead
 *********************************************************** */

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
