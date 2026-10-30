import { describe, expect, it } from 'vitest';

import { ChatRequestNonce } from './chat-request-nonce';

describe('ChatRequestNonce schema', () => {
  const allFields = ['relationId', 'keyId', 'nonce', 'expiresAt'] as const;

  it.each(allFields)('declares field "%s"', (field) => {
    expect(ChatRequestNonce.schema.path(field)).toBeDefined();
  });

  const getIndexes = () =>
    ChatRequestNonce.schema.indexes() as unknown as ReadonlyArray<
      [Record<string, unknown>, Record<string, unknown>]
    >;

  it('declares a unique compound index on (relationId, keyId, nonce)', () => {
    const indexes = getIndexes();
    const found = indexes.find(([fields, options]) => {
      const keys = Object.keys(fields);
      return (
        keys.length === 3 &&
        keys.includes('relationId') &&
        keys.includes('keyId') &&
        keys.includes('nonce') &&
        options.unique === true
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

  it('uses collection name chat_request_nonces', () => {
    const collectionName = (
      ChatRequestNonce.schema as unknown as {
        options?: { collection?: string };
      }
    ).options?.collection;
    expect(collectionName).toBe('chat_request_nonces');
  });
});
