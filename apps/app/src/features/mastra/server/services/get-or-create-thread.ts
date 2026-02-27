import type { MastraMemory } from '@mastra/core/memory';
import { v7 as uuid } from 'uuid';

import { isThreadWithMeta, type ThreadWithMeta } from '../../interfaces/thread';

type GetOrCreateThreadParams = {
  memory: MastraMemory;
  aiAssistantId: string;
  resourceId: string;
  threadId?: string;
};

export const getOrCreateThread = async ({
  memory,
  aiAssistantId,
  resourceId,
  threadId,
}: GetOrCreateThreadParams): Promise<ThreadWithMeta> => {
  if (threadId == null) {
    const newThread = await memory.createThread({
      resourceId: resourceId,
      threadId: uuid(),
      metadata: {
        aiAssistantId,
      },
    });

    if (!isThreadWithMeta(newThread)) {
      throw new Error('Failed to create thread with valid metadata');
    }

    return newThread;
  }

  const thread = await memory.getThreadById({ threadId });
  if (thread == null) {
    throw new Error('Thread not found');
  }

  if (thread.resourceId !== resourceId) {
    throw new Error('Thread does not belong to the resource');
  }

  if (!isThreadWithMeta(thread)) {
    throw new Error('Thread metadata is invalid');
  }

  return thread;
};
