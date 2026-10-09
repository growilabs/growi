// This proxy's own signing keys, one set per relation (design.md's `own_key`
// table). `private_key_pem` is encrypted at rest.
//
// **Decryption happens here and nowhere else** (design.md: 「復号は
// `own-key-repository` の中だけで行い、この層より外へ秘密鍵の値を持ち出さない」).
// That is a property of the surface below, not a comment someone has to honour:
//
//  - no function returns the decrypted PEM, or the stored ciphertext;
//  - `loadSigner` returns a `node:crypto` `KeyObject` -- the shape design.md
//    declares for `RelationKeyService.signerFor` -- which is what `sign()` takes
//    and which the signing code never has to unwrap;
//  - `listKeys` returns records that carry no key material at all, only the
//    validity and rotation columns, so the rotation steps can be composed
//    without any of them touching a key.
//
//  (A `KeyObject` can, strictly, be exported back to a PEM by a caller that
//  sets out to. It is still the right boundary: the decrypted string never
//  exists outside this module, so nothing above can leak it by accident -- by
//  logging a returned value, or by serialising a record it was handed.)
//
// **Which key signs is not decided here.** A key is addressed by `KeyRef`,
// exactly as on the peer side. During a rotation both the old and the new key
// are valid at once and design.md is explicit that the *old* one signs until
// every GROWI has accepted the new one; that ordering, and the state it reads
// (`supersededKeyId` / `deliveredToPeerAt`), belong to `RelationKeyService`.
// Deriving it here from validity dates would put half of the rotation policy in
// the storage layer, where the other half could not see it.

import { createPrivateKey, type KeyObject } from 'node:crypto';
import type { KeyRef } from '@growi/chat/server';

import type { SecretCipher } from '../../types/index.js';
import type { DbClient } from '../prisma-client.js';

export interface NewOwnKey {
  readonly keyId: string;
  /** PKCS#8 PEM. Encrypted before it reaches the database. */
  readonly privateKeyPem: string;
  readonly validFrom: Date;
  /** The `keyId` this key replaces, or `null` when not part of a rotation. */
  readonly supersededKeyId: string | null;
}

/** One own key's bookkeeping. Deliberately carries no key material. */
export interface OwnKeyRecord {
  readonly keyId: string;
  readonly validFrom: Date;
  readonly revokedAt: Date | null;
  readonly supersededKeyId: string | null;
  /** `null` means the peer has not accepted this key yet. */
  readonly deliveredToPeerAt: Date | null;
}

export interface OwnKeyRepository {
  issue(relationId: string, key: NewOwnKey): Promise<void>;
  /** The signing key for one specific `KeyRef`, or `null` when there is no such row. */
  loadSigner(
    ref: KeyRef,
  ): Promise<{ readonly key: KeyRef; readonly privateKey: KeyObject } | null>;
  listKeys(relationId: string): Promise<ReadonlyArray<OwnKeyRecord>>;
  markDeliveredToPeer(ref: KeyRef, deliveredAt: Date): Promise<void>;
  /** Closes a key's validity. The row stays, so it still counts as a revoked key. */
  revoke(ref: KeyRef, revokedAt: Date): Promise<void>;
  /**
   * Deletes every key of a relation, private key material included. Part of
   * the ordered removal sequences design.md specifies -- unpairing one
   * relation, and removing a whole installation -- both of which require
   * 「秘密鍵を残さない」. Unlike `revoke`, no row is left behind: this is only
   * called when the relation itself is going away. Composing the sequence
   * belongs to the caller (`PairingService.unpair()`,
   * `InstallationStore.remove()`); this is only the primitive.
   */
  deleteByRelation(relationId: string): Promise<number>;
}

const byRef = (ref: KeyRef) => ({
  relationId_keyId: { relationId: ref.relationId, keyId: ref.keyId },
});

export const createOwnKeyRepository = (
  db: DbClient,
  cipher: SecretCipher,
): OwnKeyRepository => ({
  issue: async (relationId, key) => {
    await db.ownKey.create({
      data: {
        relationId,
        keyId: key.keyId,
        privateKeyPem: cipher.encrypt(key.privateKeyPem),
        validFrom: key.validFrom,
        supersededKeyId: key.supersededKeyId,
      },
    });
  },

  loadSigner: async (ref) => {
    const row = await db.ownKey.findUnique({ where: byRef(ref) });
    if (row == null) {
      return null;
    }
    // Throws on a row that was altered in the database or written under another
    // key, rather than signing with something that failed authentication.
    const privateKey = createPrivateKey(cipher.decrypt(row.privateKeyPem));
    return {
      key: { relationId: ref.relationId, keyId: ref.keyId },
      privateKey,
    };
  },

  listKeys: async (relationId) => {
    const rows = await db.ownKey.findMany({
      where: { relationId },
      // The encrypted column is left out of the query entirely: a listing has
      // no use for it, and not fetching it is stronger than not returning it.
      select: {
        keyId: true,
        validFrom: true,
        revokedAt: true,
        supersededKeyId: true,
        deliveredToPeerAt: true,
      },
    });
    // Mapped column by column rather than spread, so a future column on this
    // table cannot arrive on this record just by existing -- least of all the
    // encrypted one.
    return rows.map((row) => ({
      keyId: row.keyId,
      validFrom: row.validFrom,
      revokedAt: row.revokedAt,
      supersededKeyId: row.supersededKeyId,
      deliveredToPeerAt: row.deliveredToPeerAt,
    }));
  },

  markDeliveredToPeer: async (ref, deliveredAt) => {
    await db.ownKey.update({
      where: byRef(ref),
      data: { deliveredToPeerAt: deliveredAt },
    });
  },

  revoke: async (ref, revokedAt) => {
    await db.ownKey.update({ where: byRef(ref), data: { revokedAt } });
  },

  deleteByRelation: async (relationId) => {
    const result = await db.ownKey.deleteMany({ where: { relationId } });
    return result.count;
  },
});
