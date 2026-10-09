import { describe, expect, it } from 'vitest';

import type { ChatKeyEncryptionEnv } from '../key-encryption';
import { encryptChatKeyForStorage } from '../key-encryption';
import { ChatIntegrationKey } from './chat-integration-key';

/** A clearly-fake 32-byte value; the tests only need a key AES-256 accepts. */
const TEST_ENV: ChatKeyEncryptionEnv = {
  CHAT_INTEGRATION_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
};

describe('ChatIntegrationKey schema', () => {
  const allFields = [
    'relationId',
    'side',
    'keyId',
    'key',
    'validFrom',
    'revokedAt',
  ] as const;

  it.each(allFields)('declares field "%s"', (field) => {
    expect(ChatIntegrationKey.schema.path(field)).toBeDefined();
  });

  it('side enum contains exactly own and peer', () => {
    const path = ChatIntegrationKey.schema.path('side');
    const enumValues = (path as unknown as { enumValues: string[] }).enumValues;
    expect(enumValues).toEqual(expect.arrayContaining(['own', 'peer']));
    expect(enumValues).toHaveLength(2);
  });

  it('revokedAt defaults to null', () => {
    const path = ChatIntegrationKey.schema.path('revokedAt');
    expect(
      (path as unknown as { defaultValue: unknown }).defaultValue,
    ).toBeNull();
  });

  const getIndexes = () =>
    ChatIntegrationKey.schema.indexes() as unknown as ReadonlyArray<
      [Record<string, unknown>, Record<string, unknown>]
    >;

  it('declares a unique compound index on (relationId, side, keyId)', () => {
    const indexes = getIndexes();
    const found = indexes.find(([fields, options]) => {
      const keys = Object.keys(fields);
      return (
        keys.length === 3 &&
        keys.includes('relationId') &&
        keys.includes('side') &&
        keys.includes('keyId') &&
        options.unique === true
      );
    });
    expect(found).toBeDefined();
  });

  it('uses collection name chat_integration_keys', () => {
    const collectionName = (
      ChatIntegrationKey.schema as unknown as {
        options?: { collection?: string };
      }
    ).options?.collection;
    expect(collectionName).toBe('chat_integration_keys');
  });
});

describe('ChatIntegrationKey own-side key material', () => {
  const baseFields = {
    relationId: 'relation-1',
    keyId: 'key-1',
    validFrom: new Date(),
  };

  it('refuses an own-side key that was not encrypted for storage', () => {
    const doc = new ChatIntegrationKey({
      ...baseFields,
      side: 'own',
      key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
    });

    expect(doc.validateSync()?.errors.key).toBeDefined();
  });

  it('accepts an own-side key that went through encryptChatKeyForStorage', () => {
    const doc = new ChatIntegrationKey({
      ...baseFields,
      side: 'own',
      key: encryptChatKeyForStorage('fake-own-private-key', TEST_ENV),
    });

    expect(doc.validateSync()?.errors.key).toBeUndefined();
  });

  it('stores a peer public key as it arrived, since it is not a secret', () => {
    const doc = new ChatIntegrationKey({
      ...baseFields,
      side: 'peer',
      key: '-----BEGIN PUBLIC KEY-----\nFAKE\n-----END PUBLIC KEY-----\n',
    });

    expect(doc.validateSync()?.errors.key).toBeUndefined();
  });
});
