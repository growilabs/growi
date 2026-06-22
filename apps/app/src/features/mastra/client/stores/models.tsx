import useSWR, { type SWRResponse } from 'swr';

import { apiv3Get } from '~/client/util/apiv3-client';

/**
 * A single selectable chat model.
 *
 * Only the model id (and a display name) is exposed to the client — provider
 * options are server-only and never sent (see Security Considerations).
 */
export type ChatModelOption = {
  id: string;
  name: string;
};

/**
 * Response of `GET /_api/v3/mastra/models`.
 *
 * `selectedModelId` is already validated server-side against the allow-list:
 * a since-removed or absent saved selection is rounded to the default. The
 * client trusts it as-is for the initial selection (Req 3.2/3.7).
 */
export type ChatModelsData = {
  models: ChatModelOption[];
  defaultModelId?: string;
  selectedModelId?: string;
};

/**
 * SWR hook for the chat model list, default, and server-validated current
 * selection. Used by ChatSidebar to populate the model selector.
 */
export const useSWRxChatModels = (): SWRResponse<ChatModelsData, Error> => {
  return useSWR('/mastra/models', (endpoint) =>
    apiv3Get<ChatModelsData>(endpoint).then((response) => response.data),
  );
};
