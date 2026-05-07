import { apiv3Delete } from '~/client/util/apiv3-client';

export const deleteThread = async (params: {
  threadId: string;
}): Promise<void> => {
  await apiv3Delete(`/mastra/thread/${params.threadId}`);
};
