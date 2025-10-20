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

  const setInline = async(mimeType: string): Promise<void> => {
    if (!data) return;

    const newInlineMimeTypes = [...data.inlineMimeTypes];
    const newAttachmentMimeTypes = data.attachmentMimeTypes.filter(m => m !== mimeType);

    if (!newInlineMimeTypes.includes(mimeType)) {
      newInlineMimeTypes.push(mimeType);
    }

    await trigger({
      newInlineMimeTypes,
      newAttachmentMimeTypes,
    });

    mutate();
  };

  const setAttachment = async(mimeType: string): Promise<void> => {
    if (!data) return;

    const newInlineMimeTypes = data.inlineMimeTypes.filter(m => m !== mimeType);
    const newAttachmentMimeTypes = [...data.attachmentMimeTypes];

    if (!newAttachmentMimeTypes.includes(mimeType)) {
      newAttachmentMimeTypes.push(mimeType);
    }

    await trigger({
      newInlineMimeTypes,
      newAttachmentMimeTypes,
    });

    mutate();
  };

  return {
    setInline,
    setAttachment,
  };
};
