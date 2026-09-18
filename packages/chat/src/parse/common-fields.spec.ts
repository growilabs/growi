import { describe, expect, it } from 'vitest';

import { parseChannelRef, parseChatAccountRef } from './common-fields.js';

describe('parseChatAccountRef', () => {
  const valid = { platform: 'slack', accountId: 'U123', displayName: 'Alice' };

  it('accepts a complete, valid value', () => {
    expect(parseChatAccountRef(valid)).toEqual(valid);
  });

  it('rejects a non-object value', () => {
    expect(parseChatAccountRef(null)).toBeUndefined();
    expect(parseChatAccountRef('slack')).toBeUndefined();
    expect(parseChatAccountRef([])).toBeUndefined();
  });

  it.each([
    'platform',
    'accountId',
    'displayName',
  ] as const)('rejects when %s is missing', (key) => {
    const { [key]: _omit, ...rest } = valid;
    expect(parseChatAccountRef(rest)).toBeUndefined();
  });

  it('rejects an unrecognized platform', () => {
    expect(parseChatAccountRef({ ...valid, platform: 'irc' })).toBeUndefined();
  });

  it('rejects a wrong-typed field', () => {
    expect(parseChatAccountRef({ ...valid, accountId: 123 })).toBeUndefined();
  });

  it('rejects an oversized displayName', () => {
    expect(
      parseChatAccountRef({ ...valid, displayName: 'x'.repeat(500) }),
    ).toBeUndefined();
  });
});

describe('parseChannelRef', () => {
  const valid = {
    platform: 'discord',
    channelId: 'C123',
    channelName: 'general',
    isPrivate: false,
  };

  it('accepts a complete, valid value', () => {
    expect(parseChannelRef(valid)).toEqual(valid);
  });

  it('rejects a non-object value', () => {
    expect(parseChannelRef(undefined)).toBeUndefined();
    expect(parseChannelRef(42)).toBeUndefined();
  });

  it.each([
    'platform',
    'channelId',
    'channelName',
    'isPrivate',
  ] as const)('rejects when %s is missing', (key) => {
    const { [key]: _omit, ...rest } = valid;
    expect(parseChannelRef(rest)).toBeUndefined();
  });

  it('rejects a non-boolean isPrivate', () => {
    expect(parseChannelRef({ ...valid, isPrivate: 'false' })).toBeUndefined();
  });

  it('rejects an oversized channelName', () => {
    expect(
      parseChannelRef({ ...valid, channelName: 'x'.repeat(500) }),
    ).toBeUndefined();
  });
});
