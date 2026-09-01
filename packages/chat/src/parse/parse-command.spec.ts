import { describe, expect, it } from 'vitest';

import { OP_NAMES } from '../endpoints/op-names.js';
import { parseCommandRequest } from './parse-command.js';

const actor = { platform: 'slack', accountId: 'U1', displayName: 'Alice' };
const channel = {
  platform: 'slack',
  channelId: 'C1',
  channelName: 'general',
  isPrivate: false,
};
const envelope = {
  relationId: 'rel-1',
  op: 'command',
  requestId: 'req-1',
  actor,
  channel,
};

describe('parseCommandRequest', () => {
  describe('non-object input', () => {
    it.each([null, [], 'a string', 42, undefined])('rejects %p', (value) => {
      expect(parseCommandRequest(value)).toEqual({ error: 'malformed' });
    });
  });

  describe('envelope fields', () => {
    const valid = { ...envelope, kind: 'help' };

    it('accepts a valid help command and retains relationId/op', () => {
      const result = parseCommandRequest(valid);
      expect(result).toEqual(valid);
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.relationId).toBe('rel-1');
        expect(result.op).toBe('command');
      }
    });

    it.each([
      'relationId',
      'requestId',
      'actor',
      'channel',
    ] as const)('rejects when %s is missing', (key) => {
      const { [key]: _omit, ...rest } = valid;
      expect(parseCommandRequest(rest)).toEqual({ error: 'malformed' });
    });

    it('rejects when op is missing', () => {
      const { op: _omit, ...rest } = valid;
      expect(parseCommandRequest(rest)).toEqual({ error: 'malformed' });
    });

    it('rejects an op that is not a real OP_NAMES member', () => {
      expect(parseCommandRequest({ ...valid, op: 'not-a-real-op' })).toEqual({
        error: 'malformed',
      });
    });

    it('rejects an op that IS a real OP_NAMES member but not allowed for this endpoint', () => {
      expect(parseCommandRequest({ ...valid, op: 'notification' })).toEqual({
        error: 'malformed',
      });
    });

    it.each(
      Object.values(OP_NAMES).filter((op) => op !== OP_NAMES.command),
    )('rejects every other real OP_NAMES member: %s', (op) => {
      expect(parseCommandRequest({ ...valid, op })).toEqual({
        error: 'malformed',
      });
    });

    it('rejects a wrong-typed actor', () => {
      expect(parseCommandRequest({ ...valid, actor: 'Alice' })).toEqual({
        error: 'malformed',
      });
    });

    it('rejects a wrong-typed channel', () => {
      expect(parseCommandRequest({ ...valid, channel: 'general' })).toEqual({
        error: 'malformed',
      });
    });

    it('rejects an oversized relationId', () => {
      expect(
        parseCommandRequest({ ...valid, relationId: 'x'.repeat(1000) }),
      ).toEqual({ error: 'malformed' });
    });
  });

  describe('unknown kind', () => {
    it('returns unknown-kind, not malformed', () => {
      expect(
        parseCommandRequest({ ...envelope, kind: 'delete-everything' }),
      ).toEqual({
        error: 'unknown-kind',
      });
    });

    it('returns unknown-kind when kind is missing', () => {
      expect(parseCommandRequest(envelope)).toEqual({ error: 'unknown-kind' });
    });
  });

  describe('kind: search', () => {
    const base = { ...envelope, kind: 'search', keyword: 'foo', limit: 10 };

    it('accepts a valid search command', () => {
      expect(parseCommandRequest(base)).toEqual(base);
    });

    it('rejects when keyword is missing', () => {
      const { keyword: _omit, ...rest } = base;
      expect(parseCommandRequest(rest)).toEqual({ error: 'malformed' });
    });

    it('rejects when limit is missing', () => {
      const { limit: _omit, ...rest } = base;
      expect(parseCommandRequest(rest)).toEqual({ error: 'malformed' });
    });

    it('rejects a non-integer limit', () => {
      expect(parseCommandRequest({ ...base, limit: 1.5 })).toEqual({
        error: 'malformed',
      });
    });

    it('rejects a limit of 0', () => {
      expect(parseCommandRequest({ ...base, limit: 0 })).toEqual({
        error: 'malformed',
      });
    });

    it('rejects a limit exceeding the max', () => {
      expect(parseCommandRequest({ ...base, limit: 101 })).toEqual({
        error: 'malformed',
      });
    });

    it('rejects an oversized keyword', () => {
      expect(
        parseCommandRequest({ ...base, keyword: 'x'.repeat(501) }),
      ).toEqual({ error: 'malformed' });
    });
  });

  describe('kind: create-page', () => {
    const base = {
      ...envelope,
      kind: 'create-page',
      path: '/foo',
      body: 'hello',
    };

    it('accepts a valid create-page command', () => {
      expect(parseCommandRequest(base)).toEqual(base);
    });

    it('accepts an empty body (a legitimate empty GROWI page)', () => {
      expect(parseCommandRequest({ ...base, body: '' })).toEqual({
        ...base,
        body: '',
      });
    });

    it('rejects when path is missing', () => {
      const { path: _omit, ...rest } = base;
      expect(parseCommandRequest(rest)).toEqual({ error: 'malformed' });
    });

    it('rejects when body is missing', () => {
      const { body: _omit, ...rest } = base;
      expect(parseCommandRequest(rest)).toEqual({ error: 'malformed' });
    });

    it('rejects a non-string body', () => {
      expect(parseCommandRequest({ ...base, body: 123 })).toEqual({
        error: 'malformed',
      });
    });

    it('rejects an oversized path', () => {
      expect(parseCommandRequest({ ...base, path: 'x'.repeat(4001) })).toEqual({
        error: 'malformed',
      });
    });

    it('rejects an oversized body', () => {
      expect(
        parseCommandRequest({ ...base, body: 'x'.repeat(200_001) }),
      ).toEqual({ error: 'malformed' });
    });
  });

  describe('kind: keep', () => {
    const message = {
      postedAt: '2026-01-01T00:00:00.000Z',
      author: actor,
      markdown: 'kept text',
    };
    const base = {
      ...envelope,
      kind: 'keep',
      path: '/foo',
      messages: [message],
    };

    it('accepts a valid keep command', () => {
      expect(parseCommandRequest(base)).toEqual(base);
    });

    it('accepts an empty messages array', () => {
      expect(parseCommandRequest({ ...base, messages: [] })).toEqual({
        ...base,
        messages: [],
      });
    });

    it('rejects when path is missing', () => {
      const { path: _omit, ...rest } = base;
      expect(parseCommandRequest(rest)).toEqual({ error: 'malformed' });
    });

    it('rejects when messages is missing', () => {
      const { messages: _omit, ...rest } = base;
      expect(parseCommandRequest(rest)).toEqual({ error: 'malformed' });
    });

    it('rejects a message missing a required sub-field', () => {
      const { postedAt: _omit, ...restMessage } = message;
      expect(parseCommandRequest({ ...base, messages: [restMessage] })).toEqual(
        { error: 'malformed' },
      );
    });

    it('rejects a message with a wrong-typed author', () => {
      expect(
        parseCommandRequest({
          ...base,
          messages: [{ ...message, author: 'not-an-account-ref' }],
        }),
      ).toEqual({ error: 'malformed' });
    });

    it('rejects a message with a wrong-typed markdown', () => {
      expect(
        parseCommandRequest({
          ...base,
          messages: [{ ...message, markdown: 123 }],
        }),
      ).toEqual({ error: 'malformed' });
    });

    it('rejects an oversized messages array', () => {
      const many = Array.from({ length: 201 }, () => message);
      expect(parseCommandRequest({ ...base, messages: many })).toEqual({
        error: 'malformed',
      });
    });

    it('rejects a messages array containing a non-object element', () => {
      expect(parseCommandRequest({ ...base, messages: [null] })).toEqual({
        error: 'malformed',
      });
    });

    it('accepts an empty markdown for a kept message (attachment-only)', () => {
      const blankMessage = { ...message, markdown: '' };
      expect(
        parseCommandRequest({ ...base, messages: [blankMessage] }),
      ).toEqual({ ...base, messages: [blankMessage] });
    });
  });

  describe('kind: link-preview', () => {
    const base = {
      ...envelope,
      kind: 'link-preview',
      pageUrl: 'https://growi.example/foo',
    };

    it('accepts a valid link-preview command', () => {
      expect(parseCommandRequest(base)).toEqual(base);
    });

    it('rejects when pageUrl is missing', () => {
      const { pageUrl: _omit, ...rest } = base;
      expect(parseCommandRequest(rest)).toEqual({ error: 'malformed' });
    });

    it('rejects an oversized pageUrl', () => {
      expect(
        parseCommandRequest({
          ...base,
          pageUrl: `https://x/${'y'.repeat(2001)}`,
        }),
      ).toEqual({ error: 'malformed' });
    });
  });

  describe('kind: help', () => {
    it('accepts a valid help command with no extra fields', () => {
      expect(parseCommandRequest({ ...envelope, kind: 'help' })).toEqual({
        ...envelope,
        kind: 'help',
      });
    });
  });
});
