import type { UIMessage } from 'ai';
import useSWR, { type SWRResponse } from 'swr';

import { apiv3Get } from '~/client/util/apiv3-client';

export const useSWRxMessages = (
  threadId?: string,
): SWRResponse<UIMessage[] | null> => {
  const key = threadId != null ? `/mastra/messages/${threadId}` : null;
  return useSWR(key, (endpoint) =>
    apiv3Get(endpoint).then((response) => response.data.messages),
  );
};
