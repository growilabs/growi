import { apiv3Delete } from '~/client/util/apiv3-client';

import type { IApiv3DeleteThreadParams } from '../../interfaces/thread-relation';

export const deleteThread = async (
  params: IApiv3DeleteThreadParams,
): Promise<void> => {
  await apiv3Delete(
    `/openai/thread/${params.aiAssistantId}/${params.threadRelationId}`,
  );
};
