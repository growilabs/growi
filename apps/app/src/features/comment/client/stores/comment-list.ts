import type { Nullable } from '@growi/core';
import type { SWRResponse } from 'swr';
import useSWR from 'swr';

import { apiv3Get } from '~/client/util/apiv3-client';
import { useShareLinkId } from '~/states/page/hooks';

import type {
  ICommentListItem,
  ListCommentsResponseBody,
} from '../../interfaces';

// Normalizing before it enters both the SWR key and the request keeps them in
// sync: equivalent raw values ('  ' vs '   ') must not create separate cache entries.
const normalizeShareLinkId = (
  shareLinkId: string | undefined,
): string | undefined => {
  const trimmed = shareLinkId?.trim();
  return trimmed != null && trimmed.length > 0 ? trimmed : undefined;
};

export const useSWRxCommentList = (
  pageId: Nullable<string>,
): SWRResponse<ICommentListItem[], Error> => {
  const shareLinkId = normalizeShareLinkId(useShareLinkId());

  return useSWR(
    pageId != null ? ['/comments', pageId, shareLinkId] : null,
    ([endpoint, pageId, shareLinkId]: [string, string, string | undefined]) =>
      // Send `pageId` only (never `page_id`) so share-link verification and
      // the fetch use the same identifier.
      apiv3Get<ListCommentsResponseBody>(endpoint, {
        pageId,
        ...(shareLinkId != null && { shareLinkId }),
      }).then((response) => response.data.comments),
  );
};
