import type { ThreadWithMeta } from '~/features/mastra/interfaces/thread';

import {
  buildMessageRequestBody,
  GENERIC_CHAT_HEADER_LABEL,
  resolveChatHeaderLabel,
} from './chat-sidebar-helpers';

const makeThread = (id: string, title?: string): ThreadWithMeta =>
  ({
    id,
    title,
    resourceId: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as unknown as ThreadWithMeta;

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

    expect(resolveChatHeaderLabel('thread-2', threads)).toBe('Second chat');
  });

  it('falls back to the generic label when the thread is not found', () => {
    const threads = [makeThread('thread-1', 'First chat')];

    expect(resolveChatHeaderLabel('unknown', threads)).toBe(
      GENERIC_CHAT_HEADER_LABEL,
    );
  });

  it('falls back to the generic label when the thread has no title', () => {
    const threads = [makeThread('thread-1', undefined)];

    expect(resolveChatHeaderLabel('thread-1', threads)).toBe(
      GENERIC_CHAT_HEADER_LABEL,
    );
  });

  it('falls back to the generic label for an empty title', () => {
    const threads = [makeThread('thread-1', '')];

    expect(resolveChatHeaderLabel('thread-1', threads)).toBe(
      GENERIC_CHAT_HEADER_LABEL,
    );
  });
});
