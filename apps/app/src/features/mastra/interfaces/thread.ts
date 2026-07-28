import type { StorageThreadType } from '@mastra/core/memory';
import type { PaginationInfo } from '@mastra/core/storage';

// Threads are assistant-independent (Mastra's StorageThreadType is used directly).
// Legacy threads may still carry an `aiAssistantId` surplus field in metadata; it
// is simply ignored — never required nor written for new threads.

export type ThreadListOutput = PaginationInfo & {
  threads: StorageThreadType[];
};

export type IApiv3GetThreadsParams = {
  page: number;
  perPage: number;
  field?: 'updatedAt' | 'createdAt';
  direction?: 'ASC' | 'DESC';
};
