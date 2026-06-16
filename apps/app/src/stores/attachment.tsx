import { useCallback } from 'react';
import type { IAttachmentHasId, Nullable } from '@growi/core';
import { type SWRResponseWithUtils, withUtils } from '@growi/core/dist/swr';
import useSWR, { useSWRConfig } from 'swr';

import { apiPost } from '~/client/util/apiv1-client';
import { apiv3Get } from '~/client/util/apiv3-client';
import type { IResAttachmentList } from '~/interfaces/attachment';

type Util = {
  remove(body: { attachment_id: string }): Promise<void>;
};

type IDataAttachmentList = {
  attachments: IAttachmentHasId[];
  totalAttachments: number;
  limit: number;
};

export const useSWRxAttachment = (
  attachmentId: string,
): SWRResponseWithUtils<Util, IAttachmentHasId, Error> => {
  const swrResponse = useSWR(
    [`/attachment/${attachmentId}`],
    useCallback(async ([endpoint]) => {
      const res = await apiv3Get(endpoint);
      return res.data.attachment;
    }, []),
  );

  // Utils
  const remove = useCallback(
    async (body: { attachment_id: string }) => {
      try {
        await apiPost('/attachments.remove', body);
        swrResponse.mutate(body.attachment_id);
      } catch (err) {
        throw err;
      }
    },
    [swrResponse],
  );

  return withUtils<Util, IAttachmentHasId, Error>(swrResponse, { remove });
};

export const useSWRxAttachments = (
  pageId?: Nullable<string>,
  pageNumber?: number,
): SWRResponseWithUtils<Util, IDataAttachmentList, Error> => {
  const { mutate: mutateUseSWRxAttachment } = useSWRConfig();
  const shouldFetch = pageId != null && pageNumber != null;

  const fetcher = useCallback(async ([endpoint, pageId, pageNumber]) => {
    const res = await apiv3Get<IResAttachmentList>(endpoint, {
      pageId,
      pageNumber,
    });
    const resAttachmentList = res.data;
    const { paginateResult } = resAttachmentList;
    return {
      attachments: paginateResult.docs,
      totalAttachments: paginateResult.totalDocs,
      limit: paginateResult.limit,
    };
  }, []);

  const swrResponse = useSWR(
    shouldFetch ? ['/attachment/list', pageId, pageNumber] : null,
    fetcher,
  );

  // Utils
  const remove = useCallback(
    async (body: { attachment_id: string }) => {
      const { mutate } = swrResponse;

      try {
        await apiPost('/attachments.remove', body);
        mutate();
        // Mutation for rich attachment rendering
        mutateUseSWRxAttachment(
          [`/attachment/${body.attachment_id}`],
          body.attachment_id,
        );
      } catch (err) {
        throw err;
      }
    },
    [mutateUseSWRxAttachment, swrResponse],
  );

  return withUtils<Util, IDataAttachmentList, Error>(swrResponse, { remove });
};
