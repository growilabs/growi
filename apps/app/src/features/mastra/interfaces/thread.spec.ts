import type { StorageThreadType } from '@mastra/core/memory';

import { isThreadWithMeta } from './thread';

describe('isThreadWithMeta', () => {
  const baseThread = {
    id: 'thread-1',
    resourceId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  } satisfies Omit<StorageThreadType, 'metadata'>;

  it('accepts a thread without aiAssistantId metadata (post-migration thread)', () => {
    const thread: StorageThreadType = {
      ...baseThread,
      metadata: {},
    };

    expect(isThreadWithMeta(thread)).toBe(true);
  });

  it('accepts a legacy thread that still carries an aiAssistantId surplus field (backward compat)', () => {
    const thread: StorageThreadType = {
      ...baseThread,
      metadata: {
        aiAssistantId: '507f1f77bcf86cd799439011',
      },
    };

    expect(isThreadWithMeta(thread)).toBe(true);
  });

  it('accepts a thread with null metadata', () => {
    const thread: StorageThreadType = {
      ...baseThread,
      metadata: undefined,
    };

    expect(isThreadWithMeta(thread)).toBe(true);
  });
});
