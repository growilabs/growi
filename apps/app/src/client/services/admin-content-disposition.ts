import { useCallback, useMemo } from 'react';

import type { SWRResponse } from 'swr';
import useSWR from 'swr';
import useSWRMutation, { type SWRMutationResponse } from 'swr/mutation';

import { apiv3Get, apiv3Put } from '../util/apiv3-client';

interface ContentDispositionSettings {
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

export const useContentDisposition = (): {
  setInline: (mimeType: string) => Promise<void>;
  setAttachment: (mimeType: string) => Promise<void>;
} => {
  const { data, mutate } = useSWRxContentDispositionSettings();
  const { trigger } = useSWRMUTxContentDispositionSettings();

  const inlineMimeTypesStr = data?.inlineMimeTypes?.join(',');
  const attachmentMimeTypesStr = data?.attachmentMimeTypes?.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally using array contents instead of data object reference
  const memoizedData = useMemo(() => data, [inlineMimeTypesStr, attachmentMimeTypesStr]);

  const setInline = useCallback(async(mimeType: string): Promise<void> => {
    if (!memoizedData) return;

    const newInlineMimeTypes = [...memoizedData.inlineMimeTypes];
    const newAttachmentMimeTypes = memoizedData.attachmentMimeTypes.filter(m => m !== mimeType);

    if (!newInlineMimeTypes.includes(mimeType)) {
      newInlineMimeTypes.push(mimeType);
    }

    await trigger({
      newInlineMimeTypes,
      newAttachmentMimeTypes,
    });

    mutate();
  }, [memoizedData, trigger, mutate]);

  const setAttachment = useCallback(async(mimeType: string): Promise<void> => {
    if (!memoizedData) return;

    const newInlineMimeTypes = memoizedData.inlineMimeTypes.filter(m => m !== mimeType);
    const newAttachmentMimeTypes = [...memoizedData.attachmentMimeTypes];

    if (!newAttachmentMimeTypes.includes(mimeType)) {
      newAttachmentMimeTypes.push(mimeType);
    }

    await trigger({
      newInlineMimeTypes,
      newAttachmentMimeTypes,
    });

    mutate();
  }, [memoizedData, trigger, mutate]);

  return {
    setInline,
    setAttachment,
  };
};
