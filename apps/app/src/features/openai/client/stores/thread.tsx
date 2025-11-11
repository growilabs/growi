import type { SWRResponse } from 'swr';
import useSWRImmutable from 'swr/immutable';
import useSWRMutation, { type SWRMutationResponse } from 'swr/mutation';

import { apiv3Get } from '~/client/util/apiv3-client';
import type { IThreadRelationHasId } from '~/features/openai/interfaces/thread-relation';

const getKey = (aiAssistantId?: string) =>
  aiAssistantId != null ? [`/openai/threads/${aiAssistantId}`] : null;

export const useSWRxThreads = (
  aiAssistantId?: string,
): SWRResponse<IThreadRelationHasId[], Error> => {
  const key = getKey(aiAssistantId);
  return useSWRImmutable<IThreadRelationHasId[]>(key, ([endpoint]) =>
    apiv3Get(endpoint).then((response) => response.data.threads),
  );
};

export const useSWRMUTxThreads = (
  aiAssistantId?: string,
): SWRMutationResponse<IThreadRelationHasId[], Error> => {
  const key = getKey(aiAssistantId);
  return useSWRMutation(
    key,
    ([endpoint]) =>
      apiv3Get(endpoint).then((response) => response.data.threads),
    { revalidate: true },
  );
};
