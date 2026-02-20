import type { MastraMemory, StorageThreadType } from '@mastra/core/memory';
import { v7 as uuid } from 'uuid';

export const getOrCreateThread = async (
  memory: MastraMemory,
  resourceId: string,
  threadId?: string,
): Promise<StorageThreadType> => {
  if (threadId == null) {
    const newThread = await memory.createThread({
      resourceId: resourceId,
      threadId: uuid(),
    });
    return newThread;
  }

  const thread = await memory.getThreadById({ threadId });
  if (thread == null) {
    throw new Error('Thread not found');
  }

  return thread;
};
