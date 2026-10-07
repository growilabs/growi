import type { MastraMemory, StorageThreadType } from '@mastra/core/memory';
import { mock } from 'vitest-mock-extended';

import { getOrCreateThread } from './get-or-create-thread';

describe('getOrCreateThread', () => {
  const resourceId = 'user-1';

  const createMemoryMock = (overrides?: {
    getThreadById?: MastraMemory['getThreadById'];
    createThread?: MastraMemory['createThread'];
  }): MastraMemory =>
    mock<MastraMemory>({
      getThreadById:
        overrides?.getThreadById ?? vi.fn().mockResolvedValue(null),
      createThread:
        overrides?.createThread ??
        vi.fn(
          async ({
            resourceId: rid,
            threadId,
            metadata,
          }: {
            resourceId: string;
            threadId: string;
            metadata?: Record<string, unknown>;
          }): Promise<StorageThreadType> => ({
            id: threadId,
            resourceId: rid,
            createdAt: new Date(),
            updatedAt: new Date(),
            metadata,
          }),
        ),
    });

  it('creates a new thread whose metadata does NOT contain aiAssistantId', async () => {
    const memory = createMemoryMock();

    const thread = await getOrCreateThread({ memory, resourceId });

    expect(thread.metadata ?? {}).not.toHaveProperty('aiAssistantId');
    expect(memory.createThread).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId }),
    );
    // The metadata passed to createThread must not carry aiAssistantId
    const createThreadArg = vi.mocked(memory.createThread).mock.calls[0][0];
    expect(createThreadArg.metadata ?? {}).not.toHaveProperty('aiAssistantId');
  });

  it('retrieves an existing legacy thread that still carries aiAssistantId metadata (backward compat)', async () => {
    const legacyThread: StorageThreadType = {
      id: 'thread-legacy',
      resourceId,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        aiAssistantId: '507f1f77bcf86cd799439011',
      },
    };
    const memory = createMemoryMock({
      getThreadById: vi.fn().mockResolvedValue(legacyThread),
    });

    const thread = await getOrCreateThread({
      memory,
      resourceId,
      threadId: 'thread-legacy',
    });

    expect(thread).toBe(legacyThread);
    expect(memory.createThread).not.toHaveBeenCalled();
  });

  it('throws when an existing thread does not belong to the resource', async () => {
    const otherThread: StorageThreadType = {
      id: 'thread-other',
      resourceId: 'another-user',
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {},
    };
    const memory = createMemoryMock({
      getThreadById: vi.fn().mockResolvedValue(otherThread),
    });

    await expect(
      getOrCreateThread({ memory, resourceId, threadId: 'thread-other' }),
    ).rejects.toThrow('Thread does not belong to the resource');
  });
});
