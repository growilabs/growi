import { useCallback } from 'react';
import { useSWRStatic } from '@growi/core/dist/swr';
import type { SWRResponse } from 'swr';
import useSWRMutation, { type SWRMutationResponse } from 'swr/mutation';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { CurrentPageYjsData } from '~/interfaces/yjs';
import { useIsGuestUser } from '~/stores-universal/context';

import { useCurrentPageId } from './page';

type CurrentPageYjsDataUtils = {
  updateHasYdocsNewerThanLatestRevision(
    hasYdocsNewerThanLatestRevision: boolean,
  ): void;
  updateAwarenessStateSize(awarenessStateSize: number): void;
};

export const useCurrentPageYjsData = (): SWRResponse<
  CurrentPageYjsData,
  Error
> &
  CurrentPageYjsDataUtils => {
  const { data: currentPageId } = useCurrentPageId();
  const { data: isGuestUser } = useIsGuestUser();

  const key =
    !isGuestUser && currentPageId != null
      ? `/page/${currentPageId}/yjs-data`
      : null;

  const swrResponse = useSWRStatic<CurrentPageYjsData, Error>(key, undefined);

  const updateHasYdocsNewerThanLatestRevision = useCallback(
    (hasYdocsNewerThanLatestRevision: boolean) => {
      swrResponse.mutate({
        ...swrResponse.data,
        hasYdocsNewerThanLatestRevision,
      });
    },
    [swrResponse],
  );

  const updateAwarenessStateSize = useCallback(
    (awarenessStateSize: number) => {
      swrResponse.mutate({ ...swrResponse.data, awarenessStateSize });
    },
    [swrResponse],
  );

  return Object.assign(swrResponse, {
    updateHasYdocsNewerThanLatestRevision,
    updateAwarenessStateSize,
  });
};

export const useSWRMUTxCurrentPageYjsData = (): SWRMutationResponse<
  CurrentPageYjsData,
  Error
> => {
  const { data: currentPageId } = useCurrentPageId();

  const key = currentPageId != null ? `/page/${currentPageId}/yjs-data` : null;

  return useSWRMutation(
    key,
    (endpoint) =>
      apiv3Get<{ yjsData: CurrentPageYjsData }>(endpoint).then(
        (result) => result.data.yjsData,
      ),
    { populateCache: true, revalidate: false },
  );
};
