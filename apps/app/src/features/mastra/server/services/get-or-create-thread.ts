import type { MastraMemory } from '@mastra/core/memory';
import { v7 as uuid } from 'uuid';

import { isThreadWithMeta, type ThreadWithMeta } from '../../interfaces/thread';

export const getOrCreateThread = async (
  memory: MastraMemory,
  aiAssistantId: string,
  resourceId: string,
  threadId?: string,
): Promise<ThreadWithMeta> => {
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

  if (!isThreadWithMeta(thread)) {
    throw new Error('Thread metadata is invalid');
  }

  return thread;
};
