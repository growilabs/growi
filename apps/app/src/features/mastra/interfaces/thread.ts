import type { StorageThreadType } from '@mastra/core/memory';
import type { PaginationInfo } from '@mastra/core/storage';

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

export type ThreadListOutput = PaginationInfo & {
  threads: ThreadWithMeta[];
};

export type IApiv3GetThreadsParams = {
  page: number;
  perPage: number;
  field?: 'updatedAt' | 'createdAt';
  direction?: 'ASC' | 'DESC';
};
