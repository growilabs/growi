import type { MastraMemory, StorageThreadType } from '@mastra/core/memory';
import { v7 as uuid } from 'uuid';

type GetOrCreateThreadParams = {
  memory: MastraMemory;
  resourceId: string;
  threadId?: string;
};

export const getOrCreateThread = async ({
  memory,
  resourceId,
  threadId,
}: GetOrCreateThreadParams): Promise<StorageThreadType> => {
  const existingThread =
    threadId != null ? await memory.getThreadById({ threadId }) : null;

  if (existingThread == null) {
    // Create the thread keyed only by the user (resourceId). Do not write any
    // assistant identifier into metadata.
    return memory.createThread({
      resourceId,
      threadId: threadId ?? uuid(),
    });
  }

  if (existingThread.resourceId !== resourceId) {
    throw new Error('Thread does not belong to the resource');
  }

  return existingThread;
};
