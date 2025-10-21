import useSWRMutation, { type SWRMutationResponse } from 'swr/mutation';

import { apiv3Get } from '~/client/util/apiv3-client';

import type { MessageWithCustomMetaData } from '../../interfaces/message';

export const useSWRMUTxMessages = (
  aiAssistantId?: string,
  threadId?: string,
): SWRMutationResponse<MessageWithCustomMetaData | null> => {
  const key =
    aiAssistantId != null && threadId != null
      ? [`/openai/messages/${aiAssistantId}/${threadId}`]
      : null;
  return useSWRMutation(key, ([endpoint]) =>
    apiv3Get(endpoint).then((response) => response.data.messages),
  );
};
