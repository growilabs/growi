import { describe, expect, it } from 'vitest';

import { OP_NAMES } from '../endpoints/op-names.js';
import {
  parseNotificationRequest,
  parseNotificationResult,
} from './parse-notification.js';

const valid = {
  relationId: 'rel-1',
  op: 'notification',
  requestId: 'req-1',
  targets: [{ platform: 'slack', channelId: 'C1' }],
  markdown: '**hello**',
  containsRestrictedPage: false,
};

describe('parseNotificationRequest', () => {
  describe('non-object input', () => {
    it.each([null, [], 'a string', 42, undefined])('rejects %p', (value) => {
      expect(parseNotificationRequest(value)).toEqual({ error: 'malformed' });
    });
  });

  it('accepts a valid request and retains relationId/op', () => {
    const result = parseNotificationRequest(valid);
    expect(result).toEqual(valid);
    if (!('error' in result)) {
      expect(result.relationId).toBe('rel-1');
      expect(result.op).toBe('notification');
    }
  });

  it('accepts an empty targets array', () => {
    expect(parseNotificationRequest({ ...valid, targets: [] })).toEqual({
      ...valid,
      targets: [],
    });
  });

  it.each([
    'relationId',
    'requestId',
    'targets',
    'markdown',
    'containsRestrictedPage',
  ] as const)('rejects when %s is missing', (key) => {
    const { [key]: _omit, ...rest } = valid;
    expect(parseNotificationRequest(rest)).toEqual({ error: 'malformed' });
  });

  it('rejects when op is missing', () => {
    const { op: _omit, ...rest } = valid;
    expect(parseNotificationRequest(rest)).toEqual({ error: 'malformed' });
  });

  it('rejects an op that is not a real OP_NAMES member', () => {
    expect(parseNotificationRequest({ ...valid, op: 'nope' })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects an op that IS a real OP_NAMES member but not allowed for this endpoint', () => {
    expect(parseNotificationRequest({ ...valid, op: 'command' })).toEqual({
      error: 'malformed',
    });
  });

  it.each(
    Object.values(OP_NAMES).filter((op) => op !== OP_NAMES.notification),
  )('rejects every other real OP_NAMES member: %s', (op) => {
    expect(parseNotificationRequest({ ...valid, op })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects a wrong-typed containsRestrictedPage', () => {
    expect(
      parseNotificationRequest({ ...valid, containsRestrictedPage: 'false' }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects a target with an unrecognized platform', () => {
    expect(
      parseNotificationRequest({
        ...valid,
        targets: [{ platform: 'irc', channelId: 'C1' }],
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects a target missing channelId', () => {
    expect(
      parseNotificationRequest({ ...valid, targets: [{ platform: 'slack' }] }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects an oversized targets array', () => {
    const many = Array.from({ length: 501 }, () => ({
      platform: 'slack',
      channelId: 'C1',
    }));
    expect(parseNotificationRequest({ ...valid, targets: many })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects a targets array containing a non-object element', () => {
    expect(
      parseNotificationRequest({ ...valid, targets: ['not-an-object'] }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects an empty markdown body', () => {
    expect(parseNotificationRequest({ ...valid, markdown: '' })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects an oversized markdown body', () => {
    expect(
      parseNotificationRequest({ ...valid, markdown: 'x'.repeat(50_001) }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects an oversized relationId', () => {
    expect(
      parseNotificationRequest({ ...valid, relationId: 'x'.repeat(1000) }),
    ).toEqual({ error: 'malformed' });
  });
});

describe('parseNotificationResult', () => {
  const outcome = { platform: 'slack', channelId: 'C1', status: 'posted' };
  const validResult = { outcomes: [outcome] };

  describe('non-object input', () => {
    it.each([null, [], 'a string', 42, undefined])('rejects %p', (value) => {
      expect(parseNotificationResult(value)).toEqual({ error: 'malformed' });
    });
  });

  it('accepts a valid result', () => {
    expect(parseNotificationResult(validResult)).toEqual(validResult);
  });

  it('accepts an empty outcomes array', () => {
    expect(parseNotificationResult({ outcomes: [] })).toEqual({
      outcomes: [],
    });
  });

  it('accepts an outcome carrying optional remedy and detail', () => {
    const withOptionals = {
      outcomes: [{ ...outcome, remedy: 'Invite the bot.', detail: 'n/a' }],
    };
    expect(parseNotificationResult(withOptionals)).toEqual(withOptionals);
  });

  it('rejects when outcomes is missing', () => {
    expect(parseNotificationResult({})).toEqual({ error: 'malformed' });
  });

  it.each([
    'posted',
    'bot-not-in-channel',
    'channel-not-in-installation',
    'inventory-not-ready',
    'platform-error',
    'timeout',
  ])('accepts every real status value: %s', (status) => {
    const result = { outcomes: [{ ...outcome, status }] };
    expect(parseNotificationResult(result)).toEqual(result);
  });

  it('rejects an unrecognized status value', () => {
    expect(
      parseNotificationResult({
        outcomes: [{ ...outcome, status: 'not-a-real-status' }],
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects an outcome with an unrecognized platform', () => {
    expect(
      parseNotificationResult({
        outcomes: [{ ...outcome, platform: 'irc' }],
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects an outcome missing channelId', () => {
    const { channelId: _omit, ...rest } = outcome;
    expect(parseNotificationResult({ outcomes: [rest] })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects an outcome with a wrong-typed remedy', () => {
    expect(
      parseNotificationResult({
        outcomes: [{ ...outcome, remedy: 123 }],
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects an oversized outcomes array', () => {
    const many = Array.from({ length: 501 }, () => outcome);
    expect(parseNotificationResult({ outcomes: many })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects an outcomes array containing a non-object element', () => {
    expect(parseNotificationResult({ outcomes: [null] })).toEqual({
      error: 'malformed',
    });
  });
});
