import type { IAttachmentHasId } from '@growi/core';
import type { AxiosError } from 'axios';
import axios from 'axios';
import type { SWRResponse } from 'swr';
import useSWR, { unstable_serialize } from 'swr';

export const useSWRxRef = (
  pagePath: string,
  fileNameOrId: string,
  isImmutable?: boolean,
): SWRResponse<IAttachmentHasId | null, Error> => {
  return useSWR(
    ['/_api/attachment-refs/ref', pagePath, fileNameOrId, isImmutable],
    ([endpoint, pagePath, fileNameOrId]) => {
      return axios
        .get(endpoint, {
          params: {
            pagePath,
            fileNameOrId,
          },
        })
        .then((result) => result.data.attachment)
        .catch(() => null);
    },
    {
      keepPreviousData: true,
      revalidateIfStale: !isImmutable,
      revalidateOnFocus: !isImmutable,
      revalidateOnReconnect: !isImmutable,
    },
  );
};

export const useSWRxRefs = (
  pagePath: string,
  prefix?: string,
  options?: Record<string, string | undefined>,
  isImmutable?: boolean,
): SWRResponse<IAttachmentHasId[], AxiosError<string>> => {
  const serializedOptions = unstable_serialize(options);

  return useSWR(
    [
      '/_api/attachment-refs/refs',
      pagePath,
      prefix,
      serializedOptions,
      isImmutable,
    ],
    async ([endpoint, pagePath, prefix]) => {
      return await axios
        .get(endpoint, {
          params: {
            pagePath,
            prefix,
            options,
          },
        })
        .then((result) => result.data.attachments);
    },
    {
      keepPreviousData: true,
      revalidateIfStale: !isImmutable,
      revalidateOnFocus: !isImmutable,
      revalidateOnReconnect: !isImmutable,
    },
  );
};
