import useSWR, { type SWRResponse } from 'swr';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { ChatModelsResponse } from '~/features/mastra/interfaces/chat-models-response';

/**
 * SWR hook for the chat model list and the server-validated initial selection.
 * Used by ChatSidebar to populate the model selector. The wire shape lives in the
 * shared {@link ChatModelsResponse} so server and client cannot drift.
 */
export const useSWRxChatModels = (): SWRResponse<ChatModelsResponse, Error> => {
  return useSWR('/mastra/models', (endpoint) =>
    apiv3Get<ChatModelsResponse>(endpoint).then((response) => response.data),
  );
};
