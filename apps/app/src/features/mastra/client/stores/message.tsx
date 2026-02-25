import type { UIMessage } from 'ai';
import useSWRMutation, { type SWRMutationResponse } from 'swr/mutation';

import { apiv3Get } from '~/client/util/apiv3-client';

export const useSWRMUTxMessages = (
  threadId?: string,
): SWRMutationResponse<UIMessage[] | null> => {
  const key = threadId != null ? [`/mastra/messages/${threadId}`] : null;
  return useSWRMutation(key, ([endpoint]) =>
    apiv3Get(endpoint).then((response) => response.data.messages),
  );
};
