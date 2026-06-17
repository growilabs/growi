import type { StorageThreadType } from '@mastra/core/memory';
import { mock } from 'vitest-mock-extended';

import {
  buildMessageRequestBody,
  resolveChatErrorDetail,
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

describe('resolveChatErrorDetail', () => {
  it('returns a (server-sanitized) provider message for display', () => {
    expect(
      resolveChatErrorDetail(
        new Error('model: claude-x_ was not found. Did you mean claude-x?'),
      ),
    ).toBe('model: claude-x_ was not found. Did you mean claude-x?');
  });

  it('trims surrounding whitespace (server already collapsed the message)', () => {
    expect(resolveChatErrorDetail(new Error('  hi  '))).toBe('hi');
  });

  it.each([
    ['the unknown sentinel', 'unknown'],
    ['an empty message', ''],
    ['a structured JSON body', '{"errors":[{"message":"nope"}]}'],
    ['an HTML body', '<!DOCTYPE html><html>...'],
  ])('returns undefined for %s (heading only)', (_label, msg) => {
    expect(resolveChatErrorDetail(new Error(msg))).toBeUndefined();
  });

  it('returns undefined when there is no error', () => {
    expect(resolveChatErrorDetail(undefined)).toBeUndefined();
  });
});
