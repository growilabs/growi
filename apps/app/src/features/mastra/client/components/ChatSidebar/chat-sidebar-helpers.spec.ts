import type { StorageThreadType } from '@mastra/core/memory';
import { mock } from 'vitest-mock-extended';

import {
  buildMessageRequestBody,
  resolveChatHeaderLabel,
} from './chat-sidebar-helpers';

const FALLBACK = 'New Chat';

const makeThread = (id: string, title?: string): StorageThreadType =>
  mock<StorageThreadType>({
    id,
    title,
    resourceId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

describe('buildMessageRequestBody', () => {
  it('carries only the threadId', () => {
    const body = buildMessageRequestBody('thread-abc');

    expect(body).toEqual({ threadId: 'thread-abc' });
  });

  it('does not include aiAssistantId', () => {
    const body = buildMessageRequestBody('thread-abc');

    expect(body).not.toHaveProperty('aiAssistantId');
  });
});

describe('resolveChatHeaderLabel', () => {
  it('returns the matching thread title when available', () => {
    const threads = [
      makeThread('thread-1', 'First chat'),
      makeThread('thread-2', 'Second chat'),
    ];

    expect(resolveChatHeaderLabel('thread-2', threads, FALLBACK)).toBe(
      'Second chat',
    );
  });

  it('falls back to the given label when the thread is not found', () => {
    const threads = [makeThread('thread-1', 'First chat')];

    expect(resolveChatHeaderLabel('unknown', threads, FALLBACK)).toBe(FALLBACK);
  });

  it('falls back to the given label when the thread has no title', () => {
    const threads = [makeThread('thread-1', undefined)];

    expect(resolveChatHeaderLabel('thread-1', threads, FALLBACK)).toBe(
      FALLBACK,
    );
  });

  it('falls back to the given label for an empty title', () => {
    const threads = [makeThread('thread-1', '')];

    expect(resolveChatHeaderLabel('thread-1', threads, FALLBACK)).toBe(
      FALLBACK,
    );
  });
});
