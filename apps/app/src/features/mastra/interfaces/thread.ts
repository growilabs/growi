import type { StorageThreadType } from '@mastra/core/memory';

export type ThreadWithMeta = Omit<StorageThreadType, 'metadata'> & {
  metadata: {
    aiAssistantId: string;
  };
};

export const isThreadWithMeta = (
  thread: StorageThreadType,
): thread is ThreadWithMeta => {
  return (
    thread.metadata != null &&
    typeof thread.metadata === 'object' &&
    'aiAssistantId' in thread.metadata &&
    typeof thread.metadata.aiAssistantId === 'string'
  );
};
