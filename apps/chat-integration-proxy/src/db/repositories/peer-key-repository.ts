// The GROWI side's public keys for one relation (design.md's `peer_key` table).
//
// Two invariants shape this file.
//
//  - **A key is always addressed by `KeyRef`, never by `keyId` alone.** `keyId`
//    is chosen by the key's owner, so two GROWI instances paired with the same
//    workspace may well have picked the same one; resolving by `keyId` alone
//    would verify one relation's signature against another relation's key
//    (`@growi/chat`'s key-identity.ts, Requirement 10.5/10.6).
//  - **This table holds the peer's keys only.** `resolvePublicKey` in
//    `routes/signature-guard.ts` wraps this repository precisely because it must
//    never reach this proxy's own keys -- if it could, a request signed with our
//    own key would verify against it and a reflection would succeed
//    (design.md's SignatureGuard section). Keeping the two sides in separate
//    tables, and this repository reading only one of them, is what makes that
//    structural rather than a rule someone has to remember.

import {
  type JsonWebKey as CryptoJsonWebKey,
  createPublicKey,
  type KeyObject,
} from 'node:crypto';
import type { PublicKeyRegistration } from '@growi/chat';
import type { KeyRef, RevocableKeyEntry } from '@growi/chat/server';

import type { DbClient } from '../prisma-client.js';

export interface PeerKeyRepository {
  /** Idempotent: re-registering the same `keyId` refreshes it rather than failing. */
  register(
    relationId: string,
    registration: PublicKeyRegistration,
  ): Promise<void>;
  /**
   * The key to verify a signature against, or `null` when there is none usable:
   * unknown, already revoked, or not yet active. `now` is a parameter rather
   * than read from the clock here, the same convention `judgeKeyRevocation`
   * follows, so the judgement stays deterministic.
   */
  findPublicKey(ref: KeyRef, now: Date): Promise<KeyObject | null>;
  /** Every key of the relation, in the shape `judgeKeyRevocation` reads. */
  listKeys(relationId: string): Promise<ReadonlyArray<RevocableKeyEntry>>;
  /** Closes a key's validity. The row stays: a deleted key reads as one that never existed. */
  revoke(ref: KeyRef, revokedAt: Date): Promise<void>;
  /**
   * Deletes every row of a relation. Part of the ordered removal sequences
   * design.md specifies -- unpairing one relation, and removing a whole
   * installation. Composing the sequence belongs to the caller
   * (`PairingService.unpair()`, `InstallationStore.remove()`); this is only
   * the primitive.
   */
  deleteByRelation(relationId: string): Promise<number>;
}

export const createPeerKeyRepository = (db: DbClient): PeerKeyRepository => ({
  register: async (relationId, registration) => {
    const stored = {
      publicKeyJwk: registration.publicKeyJwk as object,
      validFrom: new Date(registration.validFrom),
    };
    await db.peerKey.upsert({
      where: {
        relationId_keyId: { relationId, keyId: registration.keyId },
      },
      create: { relationId, keyId: registration.keyId, ...stored },
      // A re-registration re-opens the key: leaving `revokedAt` set would make
      // the peer believe the key is usable while every verification fails.
      update: { ...stored, revokedAt: null },
    });
  },

  findPublicKey: async (ref, now) => {
    const row = await db.peerKey.findUnique({
      where: {
        relationId_keyId: { relationId: ref.relationId, keyId: ref.keyId },
      },
    });
    if (row == null || row.revokedAt != null || row.validFrom > now) {
      return null;
    }
    // Throws when the stored material is not a key `node:crypto` accepts. The
    // registering side validates the material (`isValidPublicKeyMaterial`), so
    // a row that fails here got into the database some other way and must not
    // be turned into something a signature can be verified against.
    // `node:crypto` declares its own `JsonWebKey` (an index-signature-bearing
    // record) separately from the global one the contract type uses, so the
    // stored value is named as the former here.
    return createPublicKey({
      key: row.publicKeyJwk as CryptoJsonWebKey,
      format: 'jwk',
    });
  },

  listKeys: async (relationId) => {
    const rows = await db.peerKey.findMany({ where: { relationId } });
    return rows.map((row) => ({
      keyId: row.keyId,
      // `judgeKeyRevocation` compares these as plain strings, so both sides
      // have to be the same UTC representation.
      validFrom: row.validFrom.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
    }));
  },

  revoke: async (ref, revokedAt) => {
    await db.peerKey.update({
      where: {
        relationId_keyId: { relationId: ref.relationId, keyId: ref.keyId },
      },
      data: { revokedAt },
    });
  },

  deleteByRelation: async (relationId) => {
    const result = await db.peerKey.deleteMany({ where: { relationId } });
    return result.count;
  },
});
