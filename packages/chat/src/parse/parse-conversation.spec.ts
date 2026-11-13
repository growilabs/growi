import { describe, expect, it } from 'vitest';

import { OP_NAMES } from '../endpoints/op-names.js';
import {
  parseConversationRequest,
  parseConversationResult,
} from './parse-conversation.js';

const range = {
  messageCount: 2,
  firstPostedAt: '2026-06-01T00:00:00.000Z',
  lastPostedAt: '2026-06-01T01:00:00.000Z',
};

const message = {
  postedAt: '2026-06-01T00:00:00.000Z',
  author: { platform: 'slack', accountId: 'U1', displayName: 'Alice' },
  markdown: 'hello',
};

const success = {
  ok: true,
  messages: [message, { ...message, markdown: 'world' }],
  range,
  truncated: false,
};

const failureOf = (reason: unknown, remedy: unknown = null) => ({
  ok: false,
  failure: { reason, remedy },
});

const rejectsResult = (raw: unknown) => {
  expect(parseConversationResult(raw)).toEqual({ error: 'malformed' });
};

const request = { relationId: 'rel-1', op: 'conversation', requestId: 'req-1' };

describe('parseConversationRequest', () => {
  it.each([null, [], 'a string', 42, undefined])('rejects %p', (value) => {
    expect(parseConversationRequest(value)).toEqual({ error: 'malformed' });
  });

  it('round-trips a request that carries only the original request id', () => {
    expect(parseConversationRequest(request)).toEqual(request);
  });

  it.each([
    'relationId',
    'op',
    'requestId',
  ] as const)('rejects when %s is missing', (key) => {
    const { [key]: _omit, ...rest } = request;
    expect(parseConversationRequest(rest)).toEqual({ error: 'malformed' });
  });

  it('rejects an op that is not conversation', () => {
    expect(
      parseConversationRequest({ ...request, op: OP_NAMES.commandAnswer }),
    ).toEqual({ error: 'malformed' });
  });

  it('does not pass along a channel or thread the sender tried to name', () => {
    const parsed = parseConversationRequest({
      ...request,
      channel: { platform: 'slack', channelId: 'C-other' },
      threadRootId: 'other-thread',
    });
    expect(parsed).toEqual(request);
  });

  it('accepts a request id of exactly 128 characters and rejects 129', () => {
    const withId = (requestId: string) => ({ ...request, requestId });
    expect(parseConversationRequest(withId('r'.repeat(128)))).toEqual(
      withId('r'.repeat(128)),
    );
    expect(parseConversationRequest(withId('r'.repeat(129)))).toEqual({
      error: 'malformed',
    });
  });

  it('accepts a relation id of exactly 128 characters and rejects 129', () => {
    const withId = (relationId: string) => ({ ...request, relationId });
    expect(parseConversationRequest(withId('r'.repeat(128)))).toEqual(
      withId('r'.repeat(128)),
    );
    expect(parseConversationRequest(withId('r'.repeat(129)))).toEqual({
      error: 'malformed',
    });
  });
});

describe('parseConversationResult', () => {
  it.each([null, [], 'a string', 42, undefined, {}])('rejects %p', (value) => {
    rejectsResult(value);
  });

  it('round-trips a success with messages, range and truncated=false', () => {
    expect(parseConversationResult(success)).toEqual(success);
  });

  it('round-trips a success whose older messages were not read', () => {
    const raw = { ...success, truncated: true };
    expect(parseConversationResult(raw)).toEqual(raw);
  });

  it.each([
    'not-in-channel',
    'not-permitted',
    'unsupported',
    'rate-limited',
    'empty',
    'unknown-request',
  ])('round-trips a failure with reason %s', (reason) => {
    const raw = failureOf(reason, 'Invite the bot to the channel.');
    expect(parseConversationResult(raw)).toEqual(raw);
  });

  it.each([
    'not-in-channel',
    'not-permitted',
    'unsupported',
    'rate-limited',
    'empty',
    'unknown-request',
  ])('round-trips a failure with reason %s and no remedy', (reason) => {
    const raw = failureOf(reason, null);
    expect(parseConversationResult(raw)).toEqual(raw);
  });

  it('rejects a failure whose remedy field is absent, unlike null', () => {
    rejectsResult({ ok: false, failure: { reason: 'empty' } });
  });

  it('rejects a failure with an unknown reason', () => {
    rejectsResult(failureOf('nope'));
  });

  it('rejects a failure whose failure field is missing or null', () => {
    rejectsResult({ ok: false });
    rejectsResult({ ok: false, failure: null });
  });

  it.each([
    ['a missing ok', { messages: success.messages, range, truncated: false }],
    ['a string ok', { ...success, ok: 'true' }],
    ['a numeric ok', { ...success, ok: 1 }],
  ])('rejects a result with %s', (_label, raw) => {
    rejectsResult(raw);
  });

  it.each([
    ['missing messages', { ok: true, range, truncated: false }],
    ['missing range', { ok: true, messages: [message], truncated: false }],
    ['missing truncated', { ok: true, messages: [message], range }],
    ['a string truncated', { ...success, truncated: 'false' }],
    ['a numeric truncated', { ...success, truncated: 0 }],
    ['a null truncated', { ...success, truncated: null }],
    [
      'a range with a message count of zero',
      { ...success, range: { ...range, messageCount: 0 } },
    ],
    [
      'a range without a first date',
      {
        ...success,
        range: { messageCount: 1, lastPostedAt: range.lastPostedAt },
      },
    ],
    ['messages that is not an array', { ...success, messages: message }],
  ])('rejects a success with %s', (_label, raw) => {
    rejectsResult(raw);
  });

  it.each([
    ['postedAt', { ...message, postedAt: undefined }],
    ['author', { ...message, author: undefined }],
    ['markdown', { ...message, markdown: undefined }],
    ['an empty markdown', { ...message, markdown: '' }],
    [
      'an unknown author platform',
      { ...message, author: { ...message.author, platform: 'irc' } },
    ],
    [
      'an author without accountId',
      { ...message, author: { platform: 'slack', displayName: 'A' } },
    ],
  ])('rejects a message with %s missing or invalid', (_label, bad) => {
    rejectsResult({ ...success, messages: [message, bad] });
  });

  describe('size limits', () => {
    const withMessages = (count: number) => ({
      ...success,
      messages: Array.from({ length: count }, () => message),
      range: { ...range, messageCount: Math.min(count, 200) },
    });

    it('accepts exactly 200 messages and rejects 201', () => {
      const atLimit = withMessages(200);
      expect(parseConversationResult(atLimit)).toEqual(atLimit);
      rejectsResult(withMessages(201));
    });

    it('accepts a message markdown of exactly 20,000 characters and rejects 20,001', () => {
      const withMarkdown = (markdown: string) => ({
        ...success,
        messages: [{ ...message, markdown }],
      });
      const atLimit = withMarkdown('a'.repeat(20_000));
      expect(parseConversationResult(atLimit)).toEqual(atLimit);
      rejectsResult(withMarkdown('a'.repeat(20_001)));
    });

    it('accepts a range message count of exactly 200 and rejects 201', () => {
      const withCount = (messageCount: number) => ({
        ...success,
        range: { ...range, messageCount },
      });
      expect(parseConversationResult(withCount(200))).toEqual(withCount(200));
      rejectsResult(withCount(201));
    });

    it('accepts a postedAt of exactly 64 characters and rejects 65', () => {
      const withPostedAt = (postedAt: string) => ({
        ...success,
        messages: [{ ...message, postedAt }],
      });
      const atLimit = withPostedAt('t'.repeat(64));
      expect(parseConversationResult(atLimit)).toEqual(atLimit);
      rejectsResult(withPostedAt('t'.repeat(65)));
    });

    it('accepts a remedy of exactly 500 characters and rejects 501', () => {
      expect(
        parseConversationResult(failureOf('empty', 'r'.repeat(500))),
      ).toEqual(failureOf('empty', 'r'.repeat(500)));
      rejectsResult(failureOf('empty', 'r'.repeat(501)));
    });
  });
});
