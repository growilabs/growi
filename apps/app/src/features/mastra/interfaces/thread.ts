import type { StorageThreadType } from '@mastra/core/memory';
import type { PaginationInfo } from '@mastra/core/storage';

// Thread metadata is assistant-independent. Legacy threads created before the
// assistant deprecation may still carry an `aiAssistantId` surplus field; it is
// tolerated but never required nor written for new threads (backward compat).
export type ThreadWithMeta = StorageThreadType;

// Relaxed guard: a thread is valid regardless of whether `metadata` is present,
// so that both post-migration threads (no `aiAssistantId`) and legacy threads
// (surplus `aiAssistantId`) can be retrieved and resumed without error.
export const isThreadWithMeta = (
  thread: StorageThreadType,
): thread is ThreadWithMeta => {
  return thread.metadata == null || typeof thread.metadata === 'object';
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
