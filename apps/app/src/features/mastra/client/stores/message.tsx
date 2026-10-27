import useSWR, { type SWRResponse } from 'swr';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { CustomUIMessage } from '~/features/mastra/interfaces/chat-message';

export const useSWRxMessages = (
  threadId?: string,
): SWRResponse<CustomUIMessage[] | null> => {
  const key = threadId != null ? `/mastra/messages/${threadId}` : null;
  return useSWR(key, (endpoint) =>
    apiv3Get(endpoint).then((response) => response.data.messages),
  );
};
