// Undoing one pairing (design.md's `relation/unpair-service.ts`, Requirement
// 9.7): the administrator disconnects one GROWI from one chat workspace, and
// the workspace, its other GROWIs, and its channel inventory all stay.
//
// Two things this owes the rest of the system, and neither is incidental:
//
//  - **No private key is left behind.** `own_key` holds the key this proxy
//    signs its requests to that GROWI with, so it is deleted first, before any
//    step that can still fail.
//  - **The `relation` row itself goes.** `(installation_id, growi_uri)` is
//    unique, so a relation left in place makes every later attempt to pair the
//    same GROWI answer `already-paired` (Requirement 8.5) forever, and
//    `chat-integration-app` is written expecting a reconnection to produce a
//    NEW `relationId` (design.md 「`relation` の行を消さないと繋ぎ直せない」).
//
// The ordered deletion itself is `deleteRelationCascade` in `db/`, shared with
// `InstallationStore.remove()`; that file's header explains why it lives
// there. What is added here is this layer's vocabulary -- an "unpairing" is a
// domain operation, and `orchestration/` should be calling that rather than a
// storage primitive it has to know the shape of.
import {
  createChannelPermissionRepository,
  createOwnKeyRepository,
  createPeerKeyRepository,
  createPendingCollectionRepository,
  createProcessedNotificationRepository,
  createRelationRepository,
  type DbClient,
  deleteRelationCascade,
} from '../db/index.js';
import type { SecretCipher } from '../types/index.js';

export interface UnpairService {
  /**
   * Removes the relation and everything that hangs off it.
   *
   * **Not atomic, and safe to call again**: every foreign key onto `relation`
   * is `Restrict`, so a failure part-way through leaves rows that are stripped
   * but never orphaned, and the relation row is still there to address.
   *
   * Rejects when `relationId` names no relation -- nothing is probed first,
   * so the storage error is what reports it.
   */
  unpair(relationId: string): Promise<void>;
}

export interface UnpairServiceDeps {
  readonly db: DbClient;
  /**
   * Only `createOwnKeyRepository`'s signature asks for this: it is what
   * encrypts `private_key_pem` on the way in. Deleting the row needs no
   * plaintext, so nothing here ever calls it.
   */
  readonly cipher: SecretCipher;
}

export const createUnpairService = (deps: UnpairServiceDeps): UnpairService => {
  const { db, cipher } = deps;
  const repositories = {
    relations: createRelationRepository(db),
    ownKeys: createOwnKeyRepository(db, cipher),
    peerKeys: createPeerKeyRepository(db),
    channelPermissions: createChannelPermissionRepository(db),
    pendingCollections: createPendingCollectionRepository(db),
    processedNotifications: createProcessedNotificationRepository(db),
  };

  return {
    unpair: (relationId) => deleteRelationCascade(repositories, relationId),
  };
};
