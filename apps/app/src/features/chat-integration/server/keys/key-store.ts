// GROWI-side key storage (design.md `KeyStore` -- Requirement 9.5, 10.6).
//
// `@growi/chat` (`packages/chat/src/signature/verify.ts`) defines no named
// "KeyStore" interface -- it only declares the SHAPE of the function it
// needs handed to it: `VerifyParams.resolvePublicKey: (ref: KeyRef) =>
// Promise<KeyObject | null>`. That function's own doc comment states the two
// invariants this module exists to satisfy: it must return the PEER's key
// only (never this GROWI's own), and it must return `null` for a revoked key
// or one that is not active yet. `resolvePeerKey` below is built to match
// that signature exactly, so it can be passed straight into `verify()`.
//
// `sign()` (`packages/chat/src/signature/sign.ts`) takes a `privateKey:
// KeyObject` parameter directly -- there is no signing-callback abstraction
// in `@growi/chat` either. Per design.md ("復号する場所 -- 署名する関数の中だけ。
// 他の層へは復号した値ではなく署名する関数を渡す"), the decrypted key must not
// escape this module: `signWithOwnKey` below is the only function that reads
// the plaintext, and it hands the caller a finished `SignResult` (headers,
// nonce, expiry), never the key material itself.
//
// Both `key`-material formats are this module's own decision (nothing
// upstream fixes them): a peer's Ed25519 public key travels as a
// `PublicKeyRegistration.publicKeyJwk` (`@growi/chat`'s wire type) and is
// stored as that JWK's JSON serialization; this GROWI's own private key is
// stored as a PKCS8 PEM string, encrypted at rest by `encryptChatKeyForStorage`
// (`./key-encryption`) exactly as `chat_integration_keys`'s schema validator
// requires for `side: 'own'`.

import {
  createPrivateKey,
  createPublicKey,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';
import type { KeyOperationResult, PublicKeyRegistration } from '@growi/chat';
import {
  DEFAULT_EXPIRES_IN_SEC,
  judgeKeyRevocation,
  type KeyRef,
  type RevocableKeyEntry,
  type SignParams,
  type SignResult,
  sign,
} from '@growi/chat/server';

import {
  encryptChatKeyForStorage,
  withDecryptedChatKey,
} from './key-encryption';
import { ChatIntegrationKey } from './models/chat-integration-key';

/**
 * Resolves the PEER's signing key for a relation -- matches
 * `VerifyParams.resolvePublicKey` exactly, so it can be passed straight into
 * `@growi/chat`'s `verify()`.
 *
 * Only ever queries `side: 'peer'` -- this is what guarantees that looking up
 * a key with this GROWI's own `keyId` can never return this GROWI's own key
 * (design.md: "自分の鍵を引くと、自分が署名した要求を自分の口へ差し戻す形が通る").
 *
 * Returns `null` -- never throws for "not found" -- for every reference this
 * function cannot serve: an unknown `(relationId, keyId)` pair, a revoked
 * key, or one whose `validFrom` is still in the future (Requirement 10.6).
 */
export const resolvePeerKey = async (
  ref: KeyRef,
  now: Date = new Date(),
): Promise<KeyObject | null> => {
  const row = await ChatIntegrationKey.findOne({
    relationId: ref.relationId,
    side: 'peer',
    keyId: ref.keyId,
    validFrom: { $lte: now },
    revokedAt: null,
  }).lean();
  if (row == null) {
    return null;
  }

  try {
    return createPublicKey({
      key: JSON.parse(row.key) as JsonWebKey,
      format: 'jwk',
    });
  } catch {
    // A row that does not decode as the JWK this module writes cannot be
    // used to verify anything -- reported the same way as "no such key" so
    // callers don't need a second failure mode to handle.
    return null;
  }
};

/**
 * Stores a peer's public key under a relation. Uses `.create()` (a
 * document-path write) so `chat_integration_keys`'s schema validator runs --
 * see Implementation Notes in tasks.md for why `updateOne`-style writes
 * would silently bypass it for `side: 'own'` rows; the same write path is
 * used here for consistency even though the `side: 'peer'` validator is a
 * no-op.
 */
export const storePeerKey = async (
  ref: KeyRef,
  publicKeyJwk: JsonWebKey,
  validFrom: Date = new Date(),
): Promise<void> => {
  await ChatIntegrationKey.create({
    relationId: ref.relationId,
    side: 'peer',
    keyId: ref.keyId,
    key: JSON.stringify(publicKeyJwk),
    validFrom,
    revokedAt: null,
  });
};

/**
 * Stores this GROWI's own private key under a relation, encrypted at rest.
 *
 * MUST use `.create()`, never `updateOne`/`findOneAndUpdate`: the schema's
 * own-side validator only runs on a document-path write (Mongoose binds
 * `this` to the Query on an `updateOne`-style call, so `side` is unreadable
 * there and the check silently passes anything through -- see tasks.md
 * Implementation Notes).
 */
export const storeOwnKey = async (
  ref: KeyRef,
  privateKey: KeyObject,
  validFrom: Date = new Date(),
): Promise<void> => {
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  await ChatIntegrationKey.create({
    relationId: ref.relationId,
    side: 'own',
    keyId: ref.keyId,
    key: encryptChatKeyForStorage(pem),
    validFrom,
    revokedAt: null,
  });
};

/**
 * Revokes this GROWI's own key -- the second half of a rotation. Call
 * {@link storeOwnKey} first with a new `keyId` (the old row is left
 * untouched, so both are simultaneously valid), let the overlap period
 * pass, then call this to close the old key's validity window (design.md
 * "自分の鍵の入れ替えでは、新旧が両方有効な期間を置いてから古い鍵を失効させる").
 *
 * Unlike {@link revokePeerKey}, this does not consult `judgeKeyRevocation`:
 * that judgement exists to stop a REMOTE caller from leaving a relation with
 * no verifiable key. Revoking GROWI's own key is a decision GROWI itself
 * makes, and the caller (whatever schedules the rotation) is responsible for
 * having already registered the replacement before calling this.
 *
 * A no-op if no matching, still-valid row exists -- the update filter only
 * matches a row whose `revokedAt` is still `null`, so calling this twice
 * never overwrites an already-recorded revocation time.
 */
export const revokeOwnKey = async (
  ref: KeyRef,
  now: Date = new Date(),
): Promise<void> => {
  await ChatIntegrationKey.updateOne(
    {
      relationId: ref.relationId,
      side: 'own',
      keyId: ref.keyId,
      revokedAt: null,
    },
    { $set: { revokedAt: now } },
  );
};

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { readonly code?: unknown }).code === 11000;

/**
 * Registers a public key the PEER sent to add (design.md's
 * `key-register-to-growi`, Requirement 10.5).
 *
 * Idempotent by construction rather than by a pre-check: `(relationId, side,
 * keyId)` is unique, so a retried identical registration hits the duplicate-
 * key error from the index itself, and this function reports that the same
 * way as a first-time success (design.md's "二重に処理しないための手立て":
 * "同じ鍵の2度目の登録は何も変えずに成功を返す").
 */
export const registerPeerKey = async (
  relationId: string,
  key: PublicKeyRegistration,
): Promise<KeyOperationResult> => {
  try {
    await storePeerKey(
      { relationId, keyId: key.keyId },
      // `PublicKeyRegistration.publicKeyJwk` is `@growi/chat`'s (DOM-derived)
      // `JsonWebKey`, which carries no index signature; `storePeerKey` takes
      // `node:crypto`'s `JsonWebKey`, which requires one. Spreading into a
      // fresh object literal satisfies that requirement without a type
      // assertion -- the two shapes are otherwise identical JSON values.
      { ...key.publicKeyJwk },
      new Date(key.validFrom),
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }
    // Falls through to the same `{ status: 'ok' }` a first-time registration
    // returns -- the row already holds this key, so nothing changed.
  }
  return { status: 'ok' };
};

/**
 * Revokes one of the PEER's keys (design.md's `key-revoke-to-growi`,
 * Requirement 10.5, 10.6), refusing a revocation that would leave the
 * relation with zero currently-valid peer keys.
 *
 * The judgement itself is `@growi/chat`'s `judgeKeyRevocation` -- the one
 * function both sides of the protocol call for this, rather than each side
 * re-deriving "would this leave zero valid keys" and risking one side
 * drifting looser than the other (see that function's own header comment).
 *
 * Idempotent: `judgeKeyRevocation` accepts revoking an already-revoked (or
 * not-yet-active) key without treating it as reducing the valid count, and
 * the update filter below (`revokedAt: null`) then makes the write itself a
 * genuine no-op -- an already-set `revokedAt` is never overwritten with a
 * new timestamp.
 */
export const revokePeerKey = async (
  relationId: string,
  keyIdToRevoke: string,
  now: Date = new Date(),
): Promise<KeyOperationResult> => {
  const rows = await ChatIntegrationKey.find({
    relationId,
    side: 'peer',
  }).lean();
  const keys: RevocableKeyEntry[] = rows.map((row) => ({
    keyId: row.keyId,
    validFrom: row.validFrom.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  }));

  const judgement = judgeKeyRevocation(keys, keyIdToRevoke, now.toISOString());
  if (!judgement.ok) {
    return { status: 'rejected', reason: judgement.reason };
  }

  await ChatIntegrationKey.updateOne(
    { relationId, side: 'peer', keyId: keyIdToRevoke, revokedAt: null },
    { $set: { revokedAt: now } },
  );
  return { status: 'ok' };
};

/** What the caller of {@link signWithOwnKey} supplies -- everything `sign()` needs except the key material, which this module alone resolves and decrypts. */
export type SignWithOwnKeyParams = Omit<SignParams, 'key' | 'privateKey'> & {
  readonly relationId: string;
  readonly expiresInSec?: number;
};

/**
 * Signs a request as this GROWI, for the given relation.
 *
 * This is the "means to sign", not the key itself (design.md): the decrypted
 * private key exists only inside `withDecryptedChatKey`'s callback, for the
 * duration of the single `sign()` call, and this function returns only the
 * resulting `SignResult` -- headers, nonce, expiry. No caller of this
 * function can obtain the plaintext key through it.
 *
 * @throws if this relation has no currently-usable own-side key (none
 * registered, or all revoked / not yet active).
 */
export const signWithOwnKey = async (
  params: SignWithOwnKeyParams,
  now: Date = new Date(),
): Promise<SignResult> => {
  const { relationId, expiresInSec, ...rest } = params;

  const row = await ChatIntegrationKey.findOne({
    relationId,
    side: 'own',
    validFrom: { $lte: now },
    revokedAt: null,
  }).lean();
  if (row == null) {
    throw new Error(
      `signWithOwnKey: relation ${relationId} has no currently-usable own-side signing key`,
    );
  }

  const key: KeyRef = { relationId, keyId: row.keyId };

  return withDecryptedChatKey(row.key, (pem) => {
    const privateKey = createPrivateKey(pem);
    return sign({
      ...rest,
      expiresInSec: expiresInSec ?? DEFAULT_EXPIRES_IN_SEC,
      key,
      privateKey,
    });
  });
};
