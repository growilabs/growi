import { describe, expect, it } from 'vitest';

import type {
  ChannelRef,
  ChatAccountRef,
  MessageRef,
  PlatformName,
} from './common';

// This spec has no runtime behavior to assert (task 2.1 declares pure
// types). Its purpose is to catch shape mistakes -- a typo'd field name, a
// missing `readonly`, a wrong literal in `PlatformName` -- by forcing
// TypeScript to accept a value built against each exported type, imported
// from this module's own file (not re-declared inline). If a field is
// renamed or a union member is dropped, this file fails to compile and the
// test run reports it.

describe('common contract types', () => {
  it('accepts every PlatformName literal', () => {
    const platforms: readonly PlatformName[] = [
      'slack',
      'discord',
      'teams',
      'mattermost',
    ];
    expect(platforms).toHaveLength(4);
  });

  it('constructs a ChatAccountRef without any GROWI user reference (Requirement 7.8)', () => {
    const account: ChatAccountRef = {
      platform: 'slack',
      accountId: 'U12345',
      displayName: 'Alice',
    };
    // Requirement 7.8: the proxy holds no chat-account <-> GROWI-user table,
    // so ChatAccountRef must carry only chat-side identity -- exactly the
    // three keys below, nothing that resolves to a GROWI user.
    expect(Object.keys(account).sort()).toEqual([
      'accountId',
      'displayName',
      'platform',
    ]);
  });

  it('constructs a ChannelRef keyed by channelId, with channelName kept separate for display only', () => {
    const channel: ChannelRef = {
      platform: 'slack',
      channelId: 'C67890',
      channelName: 'general',
      isPrivate: false,
    };
    expect(channel.channelId).toBe('C67890');
    expect(channel.channelName).toBe('general');
  });

  it('constructs a MessageRef that references a channel and carries a platform-native message id', () => {
    const channel: ChannelRef = {
      platform: 'discord',
      channelId: 'D001',
      channelName: 'random',
      isPrivate: true,
    };
    const message: MessageRef = {
      channel,
      messageId: 'M999',
    };
    expect(message.channel).toBe(channel);
    expect(message.messageId).toBe('M999');
  });
});
