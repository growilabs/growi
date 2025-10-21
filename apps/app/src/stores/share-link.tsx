import type { Nullable } from '@growi/core';
import type { SWRResponse } from 'swr';
import useSWR from 'swr';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { IResShareLinkList } from '~/interfaces/share-link';

const fetchShareLinks = async (endpoint, pageId) => {
  const res = await apiv3Get<IResShareLinkList>(endpoint, {
    relatedPage: pageId,
  });
  return res.data.shareLinksResult;
};

export const useSWRxSharelink = (
  currentPageId: Nullable<string>,
): SWRResponse<IResShareLinkList['shareLinksResult'], Error> => {
  return useSWR(
    currentPageId == null ? null : ['/share-links/', currentPageId],
    ([endpoint]) => fetchShareLinks(endpoint, currentPageId),
  );
};
