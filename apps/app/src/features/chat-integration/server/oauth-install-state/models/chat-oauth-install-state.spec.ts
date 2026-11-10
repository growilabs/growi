import { describe, expect, it } from 'vitest';

import {
  ChatOAuthInstallState,
  OAUTH_INSTALL_STATE_DEFAULT_MINUTES,
} from './chat-oauth-install-state';

describe('ChatOAuthInstallState schema', () => {
  const allFields = [
    'state',
    'platform',
    'createdBy',
    'consumedAt',
    'createdAt',
    'expiresAt',
  ] as const;

  it.each(allFields)('declares field "%s"', (field) => {
    expect(ChatOAuthInstallState.schema.path(field)).toBeDefined();
  });

  it('consumedAt defaults to null', () => {
    const path = ChatOAuthInstallState.schema.path('consumedAt');
    expect((path as unknown as { defaultValue: unknown }).defaultValue).toBe(
      null,
    );
  });

  it('expiresAt defaults to now + 5 minutes -- shorter than account-link orders (10)', () => {
    const path = ChatOAuthInstallState.schema.path('expiresAt');
    expect(OAUTH_INSTALL_STATE_DEFAULT_MINUTES).toBe(5);
    const before = Date.now();
    const value = (path as unknown as { getDefault: () => Date }).getDefault();
    const after = Date.now();
    const expectedMs = OAUTH_INSTALL_STATE_DEFAULT_MINUTES * 60 * 1000;
    expect(value.getTime()).toBeGreaterThanOrEqual(before + expectedMs);
    expect(value.getTime()).toBeLessThanOrEqual(after + expectedMs);
  });

  const getIndexes = () =>
    ChatOAuthInstallState.schema.indexes() as unknown as ReadonlyArray<
      [Record<string, unknown>, Record<string, unknown>]
    >;

  it('declares a unique index on state', () => {
    const indexes = getIndexes();
    const found = indexes.find(([fields, options]) => {
      const keys = Object.keys(fields);
      return (
        keys.length === 1 && keys[0] === 'state' && options.unique === true
      );
    });
    expect(found).toBeDefined();
  });

  it('declares a TTL index on expiresAt with expireAfterSeconds: 0', () => {
    const indexes = getIndexes();
    const found = indexes.find(([fields, options]) => {
      const keys = Object.keys(fields);
      return (
        keys.length === 1 &&
        keys[0] === 'expiresAt' &&
        options.expireAfterSeconds === 0
      );
    });
    expect(found).toBeDefined();
  });

  it('uses collection name chat_oauth_install_states', () => {
    const collectionName = (
      ChatOAuthInstallState.schema as unknown as {
        options?: { collection?: string };
      }
    ).options?.collection;
    expect(collectionName).toBe('chat_oauth_install_states');
  });
});
