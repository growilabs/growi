// Encryption at rest for this feature's own-side private keys. GROWI has no
// existing mechanism for this (design.md "秘密鍵の暗号化は GROWI に前例が無い
// ので、この spec が仕組みごと決める"): `config-manager`'s `isSecret` only
// masks a value on screen, and Gen 1 stores its tokens in the clear.
//
// Two properties shape this module, both from design.md's decision table:
//
//  - **The encryption key comes from the environment only.** There is no
//    admin-screen input path, because a key kept in the database is taken
//    together with the database it protects.
//  - **A missing or malformed key means refusal, not a fallback.** Writing
//    `chat_integration_keys.key` (`side: 'own'`) or
//    `chat_pending_pairings.ownKeyPair` in the clear is the outcome the
//    refusal exists to prevent -- and since a pairing attempt cannot be
//    recorded without an encrypted `ownKeyPair`, refusing here is what makes
//    "未設定ならペアリングを始められない" hold.
//
// Decryption is deliberately shaped as {@link withDecryptedChatKey}: the
// caller passes a function and gets back only that function's result, so the
// key material never becomes a value another layer holds (design.md "復号する
// 場所 -- 署名する関数の中だけ。他の層へは復号した値ではなく署名する関数を渡す").
// This mirrors the proxy, where the decrypted PEM exists only inside
// `own-key-repository` and `signerFor` hands out the means to sign.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Just "somewhere to read named values from" -- narrower than
 * `NodeJS.ProcessEnv` on purpose, so a caller (a test above all) can pass a
 * plain object holding only the two variables this module reads, rather than
 * having to satisfy every variable this application's `ProcessEnv` declares.
 * `process.env` is assignable to it.
 */
export type ChatKeyEncryptionEnv = Readonly<Record<string, string | undefined>>;

const KEY_ENV_NAME = 'CHAT_INTEGRATION_KEY_ENCRYPTION_KEY';
const GENERATION_ENV_NAME = 'CHAT_INTEGRATION_KEY_ENCRYPTION_KEY_GENERATION';

const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

const ENVELOPE_VERSION = 'v1';
const ENVELOPE_SEPARATOR = ':';
const DEFAULT_GENERATION = 1;

/**
 * A stored own-side private key, in the form this module writes:
 *
 * ```
 * v1:<generation>:<base64 of (12-byte IV | 16-byte auth tag | ciphertext)>
 * ```
 *
 * The generation sits in the stored value itself rather than in a separate
 * column so that it can never drift from the ciphertext it describes. It
 * records which generation of the encryption key was used, which is what lets
 * a later key change find the rows it still has to re-encrypt (design.md
 * "行にどの世代の鍵で暗号化したかを持たせる").
 *
 * The type is an alias for `string` on purpose: the value is held by the
 * existing `String` schema fields without any schema change.
 */
export type EncryptedChatKeyEnvelope = string;

/**
 * The environment does not carry a usable encryption key, so nothing that
 * would have to store a private key can proceed. Thrown rather than reported
 * as a value because every caller's only correct response is to stop; the
 * admin screen asks {@link isChatKeyEncryptionConfigured} instead of catching
 * this.
 */
export class ChatKeyEncryptionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatKeyEncryptionConfigurationError';
  }
}

/**
 * The configured key, or a refusal naming what is wrong with it.
 *
 * The configured value is never repeated back in an error -- only its decoded
 * length -- so a misconfiguration report cannot become a way to read the key.
 */
const readEncryptionKey = (env: ChatKeyEncryptionEnv): Buffer => {
  const configured = env[KEY_ENV_NAME];
  if (configured == null || configured.length === 0) {
    throw new ChatKeyEncryptionConfigurationError(
      `${KEY_ENV_NAME} is not set. It encrypts the private keys this GROWI signs with, so pairing refuses to start rather than store them in the clear. Expected ${KEY_LENGTH_BYTES} random bytes, base64-encoded.`,
    );
  }

  // `Buffer.from(..., 'base64')` drops what it cannot read instead of
  // failing, so the decoded length is the check that matters.
  const key = Buffer.from(configured, 'base64');
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new ChatKeyEncryptionConfigurationError(
      `${KEY_ENV_NAME} decodes to ${key.length} bytes, but AES-256-GCM needs exactly ${KEY_LENGTH_BYTES}. Generate one with: openssl rand -base64 ${KEY_LENGTH_BYTES}`,
    );
  }
  return key;
};

const readGeneration = (env: ChatKeyEncryptionEnv): number => {
  const configured = env[GENERATION_ENV_NAME];
  if (configured == null || configured.length === 0) {
    return DEFAULT_GENERATION;
  }

  const generation = Number(configured);
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new ChatKeyEncryptionConfigurationError(
      `${GENERATION_ENV_NAME} must be a whole number of 1 or more; it marks which generation of ${KEY_ENV_NAME} a stored key was encrypted with.`,
    );
  }
  return generation;
};

const splitEnvelope = (
  value: string,
): { generation: number; payload: Buffer } | null => {
  const parts = value.split(ENVELOPE_SEPARATOR);
  if (parts.length !== 3) {
    return null;
  }

  const [version, generationPart, payloadPart] = parts;
  if (version !== ENVELOPE_VERSION) {
    return null;
  }

  const generation = Number(generationPart);
  if (
    generationPart.length === 0 ||
    !Number.isSafeInteger(generation) ||
    generation < 1
  ) {
    return null;
  }

  const payload = Buffer.from(payloadPart, 'base64');
  if (payload.length < IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES) {
    return null;
  }

  return { generation, payload };
};

/**
 * Whether a stored value is in the encrypted form this module writes. Lets a
 * caller -- or a schema validator -- reject a value that would have gone into
 * the database in the clear.
 */
export const isEncryptedChatKeyEnvelope = (value: string): boolean =>
  splitEnvelope(value) != null;

/**
 * Which generation of the encryption key a stored value was encrypted with,
 * or `null` if the value is not in this module's encrypted form. A later key
 * change reads this to find the rows it still has to re-encrypt.
 */
export const chatKeyGenerationOf = (
  envelope: EncryptedChatKeyEnvelope,
): number | null => splitEnvelope(envelope)?.generation ?? null;

/**
 * Whether the environment carries a usable encryption key. The admin screen
 * uses this to show that the variable is unset (design.md "管理画面に「環境変数
 * が未設定である」ことを出す") without having to attempt an encryption.
 */
export const isChatKeyEncryptionConfigured = (
  env: ChatKeyEncryptionEnv = process.env,
): boolean => {
  try {
    readEncryptionKey(env);
    readGeneration(env);
    return true;
  } catch (err) {
    if (err instanceof ChatKeyEncryptionConfigurationError) {
      return false;
    }
    throw err;
  }
};

/**
 * Why {@link isChatKeyEncryptionConfigured} would return `false` -- that
 * function collapses every misconfiguration to a single boolean, but the
 * admin screen (task 9.1) has to show an operator two DIFFERENT problems
 * differently: "the variable was never set" versus "it is set, but
 * malformed" (a bad key length, or an invalid
 * `CHAT_INTEGRATION_KEY_ENCRYPTION_KEY_GENERATION`). Without this
 * distinction an operator who set the variable but mistyped it sees the
 * same message as one who never touched it at all, and cannot tell what to
 * fix (tasks.md Implementation Notes on task 1.3).
 */
export type ChatKeyEncryptionConfigurationStatus =
  | { readonly configured: true }
  | {
      readonly configured: false;
      readonly reason: 'unset' | 'invalid-key' | 'invalid-generation';
    };

/**
 * The detailed counterpart of {@link isChatKeyEncryptionConfigured}, for the
 * admin screen only -- everywhere else (pairing, encryption itself) keeps
 * using the plain boolean, since a signing/pairing path only ever needs to
 * know "can I proceed", not "which of three ways is this broken".
 */
export const describeChatKeyEncryptionConfiguration = (
  env: ChatKeyEncryptionEnv = process.env,
): ChatKeyEncryptionConfigurationStatus => {
  const configuredKey = env[KEY_ENV_NAME];
  if (configuredKey == null || configuredKey.length === 0) {
    return { configured: false, reason: 'unset' };
  }

  try {
    readEncryptionKey(env);
  } catch (err) {
    if (err instanceof ChatKeyEncryptionConfigurationError) {
      return { configured: false, reason: 'invalid-key' };
    }
    throw err;
  }

  try {
    readGeneration(env);
  } catch (err) {
    if (err instanceof ChatKeyEncryptionConfigurationError) {
      return { configured: false, reason: 'invalid-generation' };
    }
    throw err;
  }

  return { configured: true };
};

/**
 * Encrypt an own-side private key for storage.
 *
 * AES-256-GCM rather than an unauthenticated mode: the stored key is read
 * back and used to sign as this GROWI, so the read has to fail on a row that
 * was altered in the database. A fresh random initialization vector per call
 * means the same key stored twice does not produce the same stored bytes.
 *
 * @throws ChatKeyEncryptionConfigurationError when the environment carries no
 * usable encryption key -- never a plaintext or otherwise readable value.
 */
export const encryptChatKeyForStorage = (
  plaintext: string,
  env: ChatKeyEncryptionEnv = process.env,
): EncryptedChatKeyEnvelope => {
  const key = readEncryptionKey(env);
  const generation = readGeneration(env);

  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  return [
    ENVELOPE_VERSION,
    String(generation),
    payload.toString('base64'),
  ].join(ENVELOPE_SEPARATOR);
};

/**
 * Run `use` with the decrypted key and return only its result.
 *
 * There is deliberately no function that decrypts and returns the key: the
 * plaintext exists for the duration of the callback and nowhere else, so a
 * signing function can be handed to other layers while the key material
 * cannot (design.md "他の層へは復号した値ではなく署名する関数を渡す"). This is
 * why the directory barrel does not re-export this function.
 *
 * @throws ChatKeyEncryptionConfigurationError when the environment carries no
 * usable encryption key.
 * @throws Error when the stored value is not in this module's encrypted form,
 * or when it does not decrypt under the configured key -- which is also how an
 * altered row fails.
 */
export const withDecryptedChatKey = <T>(
  envelope: EncryptedChatKeyEnvelope,
  use: (plaintext: string) => T,
  env: ChatKeyEncryptionEnv = process.env,
): T => {
  const key = readEncryptionKey(env);

  const parsed = splitEnvelope(envelope);
  if (parsed == null) {
    throw new Error(
      'Stored value is not in the encrypted form this feature writes.',
    );
  }

  const { payload } = parsed;
  const iv = payload.subarray(0, IV_LENGTH_BYTES);
  const authTag = payload.subarray(
    IV_LENGTH_BYTES,
    IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES,
  );
  const ciphertext = payload.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');

  return use(plaintext);
};
