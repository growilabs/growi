import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_LINK_ORDER_DEFAULT_MINUTES,
  ChatAccountLinkOrder,
} from './chat-account-link-order';

describe('ChatAccountLinkOrder schema', () => {
  const allFields = [
    'token',
    'relationId',
    'platform',
    'accountId',
    'isRevoked',
    'createdAt',
    'expiredAt',
  ] as const;

  it.each(allFields)('declares field "%s"', (field) => {
    expect(ChatAccountLinkOrder.schema.path(field)).toBeDefined();
  });

  it('isRevoked defaults to false', () => {
    const path = ChatAccountLinkOrder.schema.path('isRevoked');
    expect((path as unknown as { defaultValue: unknown }).defaultValue).toBe(
      false,
    );
  });

  it('expiredAt defaults to now + 10 minutes', () => {
    const path = ChatAccountLinkOrder.schema.path('expiredAt');
    const before = Date.now();
    const value = (path as unknown as { getDefault: () => Date }).getDefault();
    const after = Date.now();
    const expectedMs = ACCOUNT_LINK_ORDER_DEFAULT_MINUTES * 60 * 1000;
    expect(value.getTime()).toBeGreaterThanOrEqual(before + expectedMs);
    expect(value.getTime()).toBeLessThanOrEqual(after + expectedMs);
  });

  const getIndexes = () =>
    ChatAccountLinkOrder.schema.indexes() as unknown as ReadonlyArray<
      [Record<string, unknown>, Record<string, unknown>]
    >;

  it('declares a unique index on token', () => {
    const indexes = getIndexes();
    const found = indexes.find(([fields, options]) => {
      const keys = Object.keys(fields);
      return (
        keys.length === 1 && keys[0] === 'token' && options.unique === true
      );
    });
    expect(found).toBeDefined();
  });

  it('declares a TTL index on expiredAt with expireAfterSeconds: 0', () => {
    const indexes = getIndexes();
    const found = indexes.find(([fields, options]) => {
      const keys = Object.keys(fields);
      return (
        keys.length === 1 &&
        keys[0] === 'expiredAt' &&
        options.expireAfterSeconds === 0
      );
    });
    expect(found).toBeDefined();
  });

  it('uses collection name chat_account_link_orders', () => {
    const collectionName = (
      ChatAccountLinkOrder.schema as unknown as {
        options?: { collection?: string };
      }
    ).options?.collection;
    expect(collectionName).toBe('chat_account_link_orders');
  });
});
