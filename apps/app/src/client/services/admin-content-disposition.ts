import { useCallback } from 'react';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';

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

interface UseContentDisposition {
  currentSettings: ContentDispositionSettings | undefined;
  isLoading: boolean;
  isUpdating: boolean;
  updateSettings: (newSettings: ContentDispositionSettings) => Promise<ContentDispositionSettings>;
}

export const useContentDisposition = (): UseContentDisposition => {
  const { data, isLoading, mutate } = useSWR(
    '/content-disposition-settings/',
    endpoint => apiv3Get<ContentDispositionGetResponse>(endpoint).then(res => res.data.currentDispositionSettings),
  );

  const { trigger, isMutating: isUpdating } = useSWRMutation(
    '/content-disposition-settings/',
    async(endpoint: string, { arg }: { arg: ContentDispositionUpdateRequest }) => {
      const response = await apiv3Put<ContentDispositionUpdateResponse>(endpoint, arg);
      return response.data.currentDispositionSettings;
    },
  );

  const updateSettings = useCallback(async(newSettings: ContentDispositionSettings): Promise<ContentDispositionSettings> => {
    const request: ContentDispositionUpdateRequest = {
      newInlineMimeTypes: newSettings.inlineMimeTypes,
      newAttachmentMimeTypes: newSettings.attachmentMimeTypes,
    };

    const updatedData = await trigger(request);

    // Update local cache and avoid an unnecessary extra GET request
    await mutate(updatedData, { revalidate: false });

    return updatedData;
  }, [trigger, mutate]);

  return {
    currentSettings: data,
    isLoading,
    isUpdating,
    updateSettings,
  };
};
