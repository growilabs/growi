import { describe, expect, it } from 'vitest';

import type { ChatKeyEncryptionEnv } from './key-encryption';
import {
  ChatKeyEncryptionConfigurationError,
  chatKeyGenerationOf,
  describeChatKeyEncryptionConfiguration,
  encryptChatKeyForStorage,
  isChatKeyEncryptionConfigured,
  isEncryptedChatKeyEnvelope,
  withDecryptedChatKey,
} from './key-encryption';

/**
 * A clearly-fake 32-byte value. Never a real secret: the tests only need a
 * key AES-256 accepts.
 */
const TEST_KEY = Buffer.alloc(32, 3).toString('base64');
const OTHER_TEST_KEY = Buffer.alloc(32, 9).toString('base64');

/**
 * Stands in for the own-side private key. Distinctive enough that a test can
 * search the stored value for it.
 */
const PLAINTEXT_KEY =
  '-----BEGIN PRIVATE KEY-----\nFAKE-TEST-KEY-MATERIAL-abcdef\n-----END PRIVATE KEY-----\n';

// Env is passed in explicitly rather than assigned to `process.env`, so no
// test can leak configuration into another (the proxy's `loadConfig` takes
// `env` the same way).
const envWithKey = (
  overrides: ChatKeyEncryptionEnv = {},
): ChatKeyEncryptionEnv => ({
  CHAT_INTEGRATION_KEY_ENCRYPTION_KEY: TEST_KEY,
  ...overrides,
});

describe('encryptChatKeyForStorage', () => {
  it('produces a different stored value each time the same key is encrypted', () => {
    const env = envWithKey();

    const first = encryptChatKeyForStorage(PLAINTEXT_KEY, env);
    const second = encryptChatKeyForStorage(PLAINTEXT_KEY, env);

    // A reused initialization vector would make these identical, and would
    // also reveal that two rows hold the same key.
    expect(first).not.toBe(second);
  });

  it('leaves nothing of the key readable in the value that gets stored', () => {
    const stored = JSON.stringify({
      ownKeyPair: encryptChatKeyForStorage(PLAINTEXT_KEY, envWithKey()),
    });

    expect(stored).not.toContain(PLAINTEXT_KEY);
    expect(stored).not.toContain('FAKE-TEST-KEY-MATERIAL');
    expect(stored).not.toContain('BEGIN PRIVATE KEY');
    // Guards against "encryption" that is really just an encoding.
    expect(stored).not.toContain(Buffer.from(PLAINTEXT_KEY).toString('base64'));
  });

  it('records which generation of the encryption key was used', () => {
    const envelope = encryptChatKeyForStorage(PLAINTEXT_KEY, envWithKey());

    expect(chatKeyGenerationOf(envelope)).toBe(1);
  });

  it('records the configured generation, so a rotation can tell old rows apart', () => {
    const envelope = encryptChatKeyForStorage(
      PLAINTEXT_KEY,
      envWithKey({ CHAT_INTEGRATION_KEY_ENCRYPTION_KEY_GENERATION: '4' }),
    );

    expect(chatKeyGenerationOf(envelope)).toBe(4);
    expect(isEncryptedChatKeyEnvelope(envelope)).toBe(true);
  });

  describe('when the encryption key is not usable', () => {
    it('refuses instead of storing the key in the clear, naming the variable', () => {
      expect(() => encryptChatKeyForStorage(PLAINTEXT_KEY, {})).toThrow(
        ChatKeyEncryptionConfigurationError,
      );
      expect(() => encryptChatKeyForStorage(PLAINTEXT_KEY, {})).toThrow(
        /CHAT_INTEGRATION_KEY_ENCRYPTION_KEY/,
      );
    });

    it('refuses a key that decodes to the wrong number of bytes, showing both lengths', () => {
      const env = envWithKey({
        CHAT_INTEGRATION_KEY_ENCRYPTION_KEY: Buffer.alloc(16, 3).toString(
          'base64',
        ),
      });

      expect(() => encryptChatKeyForStorage(PLAINTEXT_KEY, env)).toThrow(/16/);
      expect(() => encryptChatKeyForStorage(PLAINTEXT_KEY, env)).toThrow(/32/);
    });

    it('never repeats the configured value in the error', () => {
      const wrongLengthKey = Buffer.from('fake-configured-value').toString(
        'base64',
      );
      const env = envWithKey({
        CHAT_INTEGRATION_KEY_ENCRYPTION_KEY: wrongLengthKey,
      });

      expect(() => encryptChatKeyForStorage(PLAINTEXT_KEY, env)).toThrow();
      try {
        encryptChatKeyForStorage(PLAINTEXT_KEY, env);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        expect(message).not.toContain(wrongLengthKey);
        expect(message).not.toContain('fake-configured-value');
      }
    });

    it('refuses a generation that is not a positive whole number', () => {
      const env = envWithKey({
        CHAT_INTEGRATION_KEY_ENCRYPTION_KEY_GENERATION: '0',
      });

      expect(() => encryptChatKeyForStorage(PLAINTEXT_KEY, env)).toThrow(
        /CHAT_INTEGRATION_KEY_ENCRYPTION_KEY_GENERATION/,
      );
    });
  });
});

describe('withDecryptedChatKey', () => {
  it('hands the key to the callback and returns only what the callback returns', () => {
    const env = envWithKey();
    const envelope = encryptChatKeyForStorage(PLAINTEXT_KEY, env);

    const signature = withDecryptedChatKey(
      envelope,
      (plaintext) => {
        expect(plaintext).toBe(PLAINTEXT_KEY);
        return `signed-with-${plaintext.length}-chars`;
      },
      env,
    );

    // What leaves the call is the callback's result -- never the key itself.
    expect(signature).toBe(`signed-with-${PLAINTEXT_KEY.length}-chars`);
  });

  it('fails on a stored value that was altered in the database', () => {
    const env = envWithKey();
    const envelope = encryptChatKeyForStorage(PLAINTEXT_KEY, env);

    const [version, generation, payload] = envelope.split(':');
    const raw = Buffer.from(payload, 'base64');
    // Flip a bit in the ciphertext, past the initialization vector and the
    // authentication tag. Only an authenticated mode notices this.
    raw[raw.length - 1] ^= 0x01;
    const tampered = `${version}:${generation}:${raw.toString('base64')}`;

    expect(() =>
      withDecryptedChatKey(tampered, (plaintext) => plaintext, env),
    ).toThrow();
  });

  it('fails when the configured key is not the one the value was encrypted with', () => {
    const envelope = encryptChatKeyForStorage(PLAINTEXT_KEY, envWithKey());

    expect(() =>
      withDecryptedChatKey(
        envelope,
        (plaintext) => plaintext,
        envWithKey({ CHAT_INTEGRATION_KEY_ENCRYPTION_KEY: OTHER_TEST_KEY }),
      ),
    ).toThrow();
  });

  it('fails on a value that is not in the encrypted form this feature writes', () => {
    expect(() =>
      withDecryptedChatKey(
        PLAINTEXT_KEY,
        (plaintext) => plaintext,
        envWithKey(),
      ),
    ).toThrow();
  });
});

describe('isChatKeyEncryptionConfigured', () => {
  it('reports whether the admin screen has to show a missing configuration', () => {
    expect(isChatKeyEncryptionConfigured(envWithKey())).toBe(true);
    expect(isChatKeyEncryptionConfigured({})).toBe(false);
    expect(
      isChatKeyEncryptionConfigured({
        CHAT_INTEGRATION_KEY_ENCRYPTION_KEY: Buffer.alloc(16, 3).toString(
          'base64',
        ),
      }),
    ).toBe(false);
  });
});

describe('describeChatKeyEncryptionConfiguration', () => {
  it('reports "configured: true" when the key and generation are both usable', () => {
    expect(describeChatKeyEncryptionConfiguration(envWithKey())).toEqual({
      configured: true,
    });
  });

  it('distinguishes "unset" (variable never provided) from "invalid-key" (wrong length)', () => {
    expect(describeChatKeyEncryptionConfiguration({})).toEqual({
      configured: false,
      reason: 'unset',
    });
    expect(
      describeChatKeyEncryptionConfiguration({
        CHAT_INTEGRATION_KEY_ENCRYPTION_KEY: '',
      }),
    ).toEqual({ configured: false, reason: 'unset' });
    expect(
      describeChatKeyEncryptionConfiguration({
        CHAT_INTEGRATION_KEY_ENCRYPTION_KEY: Buffer.alloc(16, 3).toString(
          'base64',
        ),
      }),
    ).toEqual({ configured: false, reason: 'invalid-key' });
  });

  it('reports "invalid-generation" separately when the key is fine but the generation is not', () => {
    expect(
      describeChatKeyEncryptionConfiguration(
        envWithKey({ CHAT_INTEGRATION_KEY_ENCRYPTION_KEY_GENERATION: '0' }),
      ),
    ).toEqual({ configured: false, reason: 'invalid-generation' });
  });
});

describe('isEncryptedChatKeyEnvelope', () => {
  it('tells an encrypted value apart from a plaintext one', () => {
    expect(
      isEncryptedChatKeyEnvelope(
        encryptChatKeyForStorage(PLAINTEXT_KEY, envWithKey()),
      ),
    ).toBe(true);
    expect(isEncryptedChatKeyEnvelope(PLAINTEXT_KEY)).toBe(false);
    expect(isEncryptedChatKeyEnvelope('')).toBe(false);
    expect(chatKeyGenerationOf(PLAINTEXT_KEY)).toBeNull();
  });
});
