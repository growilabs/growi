import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';

import type { ChatKeyEncryptionEnv } from '../../keys/key-encryption';
import { encryptChatKeyForStorage } from '../../keys/key-encryption';
import { ChatPendingPairing } from './pending-pairing';

/** A clearly-fake 32-byte value; the tests only need a key AES-256 accepts. */
const TEST_ENV: ChatKeyEncryptionEnv = {
  CHAT_INTEGRATION_KEY_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
};

describe('ChatPendingPairing schema', () => {
  const allFields = [
    'registrationCode',
    'proxyUri',
    'growiUri',
    'createdBy',
    'ownKeyId',
    'ownKeyPair',
    'expiresAt',
  ] as const;

  it.each(allFields)('declares field "%s"', (field) => {
    expect(ChatPendingPairing.schema.path(field)).toBeDefined();
  });

  it('createdBy is an ObjectId', () => {
    const path = ChatPendingPairing.schema.path('createdBy');
    expect(path.instance.toLowerCase()).toBe('objectid');
  });

  const getIndexes = () =>
    ChatPendingPairing.schema.indexes() as unknown as ReadonlyArray<
      [Record<string, unknown>, Record<string, unknown>]
    >;

  it('declares a unique index on registrationCode', () => {
    const indexes = getIndexes();
    const found = indexes.find(([fields, options]) => {
      const keys = Object.keys(fields);
      return (
        keys.length === 1 &&
        keys[0] === 'registrationCode' &&
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

  it('uses collection name chat_pending_pairings', () => {
    const collectionName = (
      ChatPendingPairing.schema as unknown as {
        options?: { collection?: string };
      }
    ).options?.collection;
    expect(collectionName).toBe('chat_pending_pairings');
  });
});

describe('ChatPendingPairing own key material', () => {
  const baseFields = {
    registrationCode: 'code-1',
    proxyUri: 'https://proxy.example.com',
    growiUri: 'https://growi.example.com',
    createdBy: new mongoose.Types.ObjectId(),
    ownKeyId: 'key-1',
    expiresAt: new Date(),
  };

  it('refuses a key pair that was not encrypted for storage', () => {
    const doc = new ChatPendingPairing({
      ...baseFields,
      ownKeyPair:
        '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n',
    });

    expect(doc.validateSync()?.errors.ownKeyPair).toBeDefined();
  });

  it('accepts a key pair that went through encryptChatKeyForStorage', () => {
    const doc = new ChatPendingPairing({
      ...baseFields,
      ownKeyPair: encryptChatKeyForStorage('fake-own-key-pair', TEST_ENV),
    });

    expect(doc.validateSync()?.errors.ownKeyPair).toBeUndefined();
  });
});
