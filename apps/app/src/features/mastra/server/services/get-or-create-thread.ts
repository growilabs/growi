import type { MastraMemory } from '@mastra/core/memory';
import { v7 as uuid } from 'uuid';

import { isThreadWithMeta, type ThreadWithMeta } from '../../interfaces/thread';

type GetOrCreateThreadParams = {
  memory: MastraMemory;
  resourceId: string;
  threadId?: string;
  // Accepted for backward compatibility with callers that still pass it, but
  // intentionally ignored: thread lifecycle is assistant-independent and the
  // identifier is never written to thread metadata. Removed by a later task.
  aiAssistantId?: string;
};

export const getOrCreateThread = async ({
  memory,
  resourceId,
  threadId,
}: GetOrCreateThreadParams): Promise<ThreadWithMeta> => {
  const existingThread =
    threadId != null ? await memory.getThreadById({ threadId }) : null;

  if (existingThread == null) {
    // Create the thread keyed only by the user (resourceId). Do not write any
    // assistant identifier into metadata.
    const newThread = await memory.createThread({
      resourceId,
      threadId: threadId ?? uuid(),
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
