import { describe, expect, it } from 'vitest';

import { OP_NAMES } from '../endpoints/op-names.js';
import {
  parseCommandAnswerRequest,
  parseCommandAnswerResult,
} from './parse-command-answer.js';

const range = {
  messageCount: 12,
  firstPostedAt: '2026-06-01T00:00:00.000Z',
  lastPostedAt: '2026-06-01T01:00:00.000Z',
};

const textAnswer = {
  kind: 'text',
  markdown: 'The answer.',
  sources: [{ title: 'Page', url: 'https://growi.example/page' }],
};

const requestWith = (answer: unknown) => ({
  relationId: 'rel-1',
  op: 'command-answer',
  requestId: 'req-1',
  answer,
});

const rejects = (raw: unknown) => {
  expect(parseCommandAnswerRequest(raw)).toEqual({ error: 'malformed' });
};

describe('parseCommandAnswerRequest', () => {
  it.each([null, [], 'a string', 42, undefined])('rejects %p', (value) => {
    rejects(value);
  });

  it('round-trips a text answer with its sources', () => {
    const raw = requestWith(textAnswer);
    expect(parseCommandAnswerRequest(raw)).toEqual(raw);
  });

  it('round-trips a text answer without sources', () => {
    const raw = requestWith({ ...textAnswer, sources: [] });
    expect(parseCommandAnswerRequest(raw)).toEqual(raw);
  });

  it('round-trips a page-created answer with the summarized range', () => {
    const raw = requestWith({
      kind: 'page-created',
      pageUrl: 'https://growi.example/user/alice/memo/summary',
      range,
      truncated: true,
    });
    expect(parseCommandAnswerRequest(raw)).toEqual(raw);
  });

  it.each([
    'timeout',
    'agent-error',
    'path-conflict',
    'forbidden',
    'conversation-unavailable',
  ])('round-trips a failed answer with reason %s', (reason) => {
    const raw = requestWith({ kind: 'failed', reason });
    expect(parseCommandAnswerRequest(raw)).toEqual(raw);
  });

  it('round-trips a failed answer that carries why the conversation could not be read', () => {
    const raw = requestWith({
      kind: 'failed',
      reason: 'conversation-unavailable',
      conversationFailure: {
        reason: 'not-in-channel',
        remedy: 'Invite the bot to the channel.',
      },
    });
    expect(parseCommandAnswerRequest(raw)).toEqual(raw);
  });

  it('round-trips a conversation failure that has no remedy', () => {
    const raw = requestWith({
      kind: 'failed',
      reason: 'conversation-unavailable',
      conversationFailure: { reason: 'empty', remedy: null },
    });
    expect(parseCommandAnswerRequest(raw)).toEqual(raw);
  });

  it.each([
    'relationId',
    'op',
    'requestId',
    'answer',
  ] as const)('rejects when %s is missing', (key) => {
    const { [key]: _omit, ...rest } = requestWith(textAnswer);
    rejects(rest);
  });

  it('rejects an op that is not command-answer', () => {
    rejects({ ...requestWith(textAnswer), op: OP_NAMES.notification });
  });

  it('rejects an answer of an unknown kind', () => {
    rejects(requestWith({ kind: 'keep', markdown: 'x', sources: [] }));
  });

  it('rejects an unknown failure reason', () => {
    rejects(requestWith({ kind: 'failed', reason: 'because' }));
  });

  it('rejects a conversation failure whose remedy field is absent, unlike null', () => {
    rejects(
      requestWith({
        kind: 'failed',
        reason: 'conversation-unavailable',
        conversationFailure: { reason: 'empty' },
      }),
    );
  });

  it('rejects a conversation failure with an unknown reason', () => {
    rejects(
      requestWith({
        kind: 'failed',
        reason: 'conversation-unavailable',
        conversationFailure: { reason: 'nope', remedy: null },
      }),
    );
  });

  it.each([
    ['a missing markdown', { kind: 'text', sources: [] }],
    ['an empty markdown', { kind: 'text', markdown: '', sources: [] }],
    ['missing sources', { kind: 'text', markdown: 'x' }],
    [
      'a source without a url',
      { kind: 'text', markdown: 'x', sources: [{ title: 'T' }] },
    ],
    [
      'a source without a title',
      { kind: 'text', markdown: 'x', sources: [{ url: 'https://a' }] },
    ],
  ])('rejects a text answer with %s', (_label, answer) => {
    rejects(requestWith(answer));
  });

  it.each([
    [
      'a missing range',
      { kind: 'page-created', pageUrl: 'https://a', truncated: false },
    ],
    [
      'a missing truncated flag',
      { kind: 'page-created', pageUrl: 'https://a', range },
    ],
    ['a missing pageUrl', { kind: 'page-created', range, truncated: false }],
    [
      'a range with a missing date',
      {
        kind: 'page-created',
        pageUrl: 'https://a',
        range: { messageCount: 1, firstPostedAt: 'x' },
        truncated: false,
      },
    ],
    [
      'a range with a missing first date',
      {
        kind: 'page-created',
        pageUrl: 'https://a',
        range: { messageCount: 1, lastPostedAt: '2026-06-01T01:00:00.000Z' },
        truncated: false,
      },
    ],
    [
      'a non-integer message count',
      {
        kind: 'page-created',
        pageUrl: 'https://a',
        range: { ...range, messageCount: 1.5 },
        truncated: false,
      },
    ],
    [
      'a message count of zero',
      {
        kind: 'page-created',
        pageUrl: 'https://a',
        range: { ...range, messageCount: 0 },
        truncated: false,
      },
    ],
  ])('rejects a page-created answer with %s', (_label, answer) => {
    rejects(requestWith(answer));
  });

  describe('size limits', () => {
    it('accepts a markdown of exactly 30,000 characters and rejects 30,001', () => {
      const atLimit = requestWith({
        ...textAnswer,
        markdown: 'a'.repeat(30_000),
      });
      expect(parseCommandAnswerRequest(atLimit)).toEqual(atLimit);
      rejects(requestWith({ ...textAnswer, markdown: 'a'.repeat(30_001) }));
    });

    it('accepts exactly 20 sources and rejects 21', () => {
      const source = { title: 'Page', url: 'https://growi.example/page' };
      const atLimit = requestWith({
        ...textAnswer,
        sources: Array.from({ length: 20 }, () => source),
      });
      expect(parseCommandAnswerRequest(atLimit)).toEqual(atLimit);
      rejects(
        requestWith({
          ...textAnswer,
          sources: Array.from({ length: 21 }, () => source),
        }),
      );
    });

    it('accepts a source title of exactly 500 characters and rejects 501', () => {
      const withTitle = (title: string) =>
        requestWith({
          ...textAnswer,
          sources: [{ title, url: 'https://growi.example/page' }],
        });
      const atLimit = withTitle('t'.repeat(500));
      expect(parseCommandAnswerRequest(atLimit)).toEqual(atLimit);
      rejects(withTitle('t'.repeat(501)));
    });

    it('accepts a source url of exactly 2,000 characters and rejects 2,001', () => {
      const withUrl = (url: string) =>
        requestWith({ ...textAnswer, sources: [{ title: 'T', url }] });
      const atLimit = withUrl('u'.repeat(2000));
      expect(parseCommandAnswerRequest(atLimit)).toEqual(atLimit);
      rejects(withUrl('u'.repeat(2001)));
    });

    it('accepts exactly 200 messages in a range and rejects 201', () => {
      const withCount = (messageCount: number) =>
        requestWith({
          kind: 'page-created',
          pageUrl: 'https://a',
          range: { ...range, messageCount },
          truncated: false,
        });
      const atLimit = withCount(200);
      expect(parseCommandAnswerRequest(atLimit)).toEqual(atLimit);
      rejects(withCount(201));
    });

    it('accepts a page url of exactly 2,000 characters and rejects 2,001', () => {
      const withUrl = (pageUrl: string) =>
        requestWith({ kind: 'page-created', pageUrl, range, truncated: false });
      const atLimit = withUrl('u'.repeat(2000));
      expect(parseCommandAnswerRequest(atLimit)).toEqual(atLimit);
      rejects(withUrl('u'.repeat(2001)));
    });
  });
});

describe('parseCommandAnswerResult', () => {
  it.each([
    'delivered',
    'undeliverable',
    'unknown-request',
    'in-progress',
  ])('round-trips status %s', (status) => {
    expect(parseCommandAnswerResult({ status })).toEqual({ status });
  });

  it.each([
    null,
    [],
    'delivered',
    {},
    { status: 'done' },
    { status: 42 },
  ])('rejects %p', (value) => {
    expect(parseCommandAnswerResult(value)).toEqual({ error: 'malformed' });
  });
});
