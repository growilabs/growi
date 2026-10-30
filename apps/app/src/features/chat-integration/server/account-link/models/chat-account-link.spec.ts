import { describe, expect, it } from 'vitest';

import { ChatAccountLink } from './chat-account-link';

describe('ChatAccountLink schema', () => {
  const allFields = [
    'relationId',
    'userId',
    'platform',
    'accountId',
    'linkedAt',
  ] as const;

  it.each(allFields)('declares field "%s"', (field) => {
    expect(ChatAccountLink.schema.path(field)).toBeDefined();
  });

  it('userId is an ObjectId', () => {
    const path = ChatAccountLink.schema.path('userId');
    expect(path.instance.toLowerCase()).toBe('objectid');
  });

  const getIndexes = () =>
    ChatAccountLink.schema.indexes() as unknown as ReadonlyArray<
      [Record<string, unknown>, Record<string, unknown>]
    >;

  it('declares the exact unique compound index (relationId, platform, accountId) required by Requirement 7.4', () => {
    const indexes = getIndexes();
    const found = indexes.find(([fields, options]) => {
      const keys = Object.keys(fields);
      return (
        keys.length === 3 &&
        keys.includes('relationId') &&
        keys.includes('platform') &&
        keys.includes('accountId') &&
        options.unique === true
      );
    });
    expect(found).toBeDefined();
  });

  it('does NOT declare a unique index on (platform, accountId) alone (would break the multi-workspace invariant)', () => {
    const indexes = getIndexes();
    const wrongIndex = indexes.find(([fields, options]) => {
      const keys = Object.keys(fields);
      return (
        keys.length === 2 &&
        keys.includes('platform') &&
        keys.includes('accountId') &&
        options.unique === true
      );
    });
    expect(wrongIndex).toBeUndefined();
  });

  it('uses collection name chat_account_links', () => {
    const collectionName = (
      ChatAccountLink.schema as unknown as {
        options?: { collection?: string };
      }
    ).options?.collection;
    expect(collectionName).toBe('chat_account_links');
  });
});
