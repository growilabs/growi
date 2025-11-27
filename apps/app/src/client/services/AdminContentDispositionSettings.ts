import { useCallback, useMemo } from 'react';

import type { SWRResponse } from 'swr';
import useSWR from 'swr';
import useSWRMutation, { type SWRMutationResponse } from 'swr/mutation';

import { apiv3Get, apiv3Put } from '../util/apiv3-client';

export interface ContentDispositionSettings {
  inlineMimeTypes: string[];
  attachmentMimeTypes: string[];
}

interface ContentDispositionGetResponse {
  currentDispositionSettings: ContentDispositionSettings;
}

interface ContentDispositionUpdateRequest {
  newInlineMimeTypes: string[];
  newAttachmentMimeTypes: string[];
}

interface ContentDispositionUpdateResponse {
  currentDispositionSettings: ContentDispositionSettings;
}

export const useSWRxContentDispositionSettings = (): SWRResponse<ContentDispositionSettings, Error> => {
  return useSWR(
    '/content-disposition-settings/',
    endpoint => apiv3Get<ContentDispositionGetResponse>(endpoint).then((response) => {
      return response.data.currentDispositionSettings;
    }),
  );
};

export const useSWRMUTxContentDispositionSettings = (): SWRMutationResponse<
  ContentDispositionSettings,
  Error,
  string,
  ContentDispositionUpdateRequest
> => {
  return useSWRMutation(
    '/content-disposition-settings/',
    async(endpoint: string, { arg }: { arg: ContentDispositionUpdateRequest }) => {
      const response = await apiv3Put<ContentDispositionUpdateResponse>(endpoint, arg);
      return response.data.currentDispositionSettings;
    },
  );
};

// --- REFACTORED HOOK ---
export const useContentDisposition = (): {
  currentSettings: ContentDispositionSettings | undefined;
  isLoading: boolean;
  isUpdating: boolean;
  updateSettings: (newSettings: ContentDispositionSettings) => Promise<ContentDispositionSettings>;
} => {
  const {
    data, isLoading, mutate, error,
  } = useSWRxContentDispositionSettings();
  const { trigger, isMutating } = useSWRMUTxContentDispositionSettings();

  const inlineMimeTypesStr = data?.inlineMimeTypes?.join(',');
  const attachmentMimeTypesStr = data?.attachmentMimeTypes?.join(',');

  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally using array contents instead of data object reference
  const memoizedData = useMemo(() => data, [inlineMimeTypesStr, attachmentMimeTypesStr]);
  const currentSettings = memoizedData;

  // New unified update function
  const updateSettings = useCallback(async(newSettings: ContentDispositionSettings): Promise<ContentDispositionSettings> => {

    // Create the request object matching the backend API
    const request: ContentDispositionUpdateRequest = {
      newInlineMimeTypes: newSettings.inlineMimeTypes,
      newAttachmentMimeTypes: newSettings.attachmentMimeTypes,
    };

    // 1. Trigger the mutation
    const updatedData = await trigger(request);

    // 2. Optimistically update SWR cache with the response from the server,
    //    or simply re-validate by calling mutate(). Since 'trigger' returns the
    //    new data, we can use that to update the local cache immediately.
    //    We don't need to await the full re-fetch from the network.
    mutate(updatedData, { revalidate: true });

    return updatedData;
  }, [trigger, mutate]);


  return {
    currentSettings,
    isLoading,
    isUpdating: isMutating,
    updateSettings,
    // Note: If you need a function to force a fresh data fetch (for a hard "Reset"),
    // you can expose `mutate` from useSWRxContentDispositionSettings() as `fetchSettings`
  };
};
