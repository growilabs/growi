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
  const existingThread =
    threadId != null ? await memory.getThreadById({ threadId }) : null;

  if (existingThread == null) {
    const newThread = await memory.createThread({
      resourceId,
      threadId: threadId ?? uuid(),
      metadata: {
        aiAssistantId,
      },
    });

    if (!isThreadWithMeta(newThread)) {
      throw new Error('Failed to create thread with valid metadata');
    }

    return newThread;
  }

  if (existingThread.resourceId !== resourceId) {
    throw new Error('Thread does not belong to the resource');
  }

  if (!isThreadWithMeta(existingThread)) {
    throw new Error('Thread metadata is invalid');
  }

  return existingThread;
};
