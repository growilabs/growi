import { describe, expect, it } from 'vitest';

import { ChatChannelPermission } from './chat-channel-permission';

describe('ChatChannelPermission schema', () => {
  const allFields = [
    'relationId',
    'commandName',
    'channelScope',
    'allowedChannels',
  ] as const;

  it.each(allFields)('declares field "%s"', (field) => {
    expect(ChatChannelPermission.schema.path(field)).toBeDefined();
  });

  it('does NOT declare a per-row updatedAt (version lives on chat_relations.settingsVersion instead)', () => {
    expect(ChatChannelPermission.schema.path('updatedAt')).toBeUndefined();
  });

  const getIndexes = () =>
    ChatChannelPermission.schema.indexes() as unknown as ReadonlyArray<
      [Record<string, unknown>, Record<string, unknown>]
    >;

  it('declares a unique compound index on (relationId, commandName)', () => {
    const indexes = getIndexes();
    const found = indexes.find(([fields, options]) => {
      const keys = Object.keys(fields);
      return (
        keys.length === 2 &&
        keys.includes('relationId') &&
        keys.includes('commandName') &&
        options.unique === true
      );
    });
    expect(found).toBeDefined();
  });

  describe('channelScope (the "allowed in every / no channel" values)', () => {
    const build = (overrides: Record<string, unknown> = {}) =>
      new ChatChannelPermission({
        relationId: 'relation-under-test',
        commandName: 'search',
        ...overrides,
      });

    it("treats a row written without a scope as an explicit channel list ('listed')", () => {
      expect(build().channelScope).toBe('listed');
    });

    it.each([
      'all',
      'none',
      'listed',
    ] as const)('accepts the scope "%s"', (channelScope) => {
      expect(build({ channelScope }).validateSync()).toBeUndefined();
    });

    it('refuses a scope value neither side of the protocol knows', () => {
      const error = build({ channelScope: 'everything' }).validateSync();
      expect(error?.errors.channelScope).toBeDefined();
    });
  });

  it('uses collection name chat_channel_permissions', () => {
    const collectionName = (
      ChatChannelPermission.schema as unknown as {
        options?: { collection?: string };
      }
    ).options?.collection;
    expect(collectionName).toBe('chat_channel_permissions');
  });
});
