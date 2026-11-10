// Removing ONE relation and everything that hangs off it, in the one order the
// schema allows (design.md's 「紐付けを解除したとき（要件 9.7）」).
//
// **Why this sits in `db/` rather than in `relation/`.** design.md asked for
// the shared sequence to be lifted into `relation/` once `unpair()` existed,
// but it has two callers on opposite sides of the layer order:
// `platform/installation-store.ts` (`remove()`, which repeats it for every
// relation of an installation) and `relation/unpair-service.ts`. `platform/`
// sits to the LEFT of `relation/` (`architecture.spec.ts`, guard 1), so a home
// in `relation/` would be unreachable from the caller that already had this
// code. `db/` is to the left of both, and the sequence needs nothing from
// either layer: it is a composition of `db/`'s OWN repositories, which is
// exactly the character of this layer.
//
// **The order is a requirement, not a preference.** Every foreign key onto
// `relation` is `Restrict` (schema.prisma, task 1.4), so a parent deleted
// before its children is rejected by PostgreSQL rather than silently cascaded.
//
// **`own_key` goes first for a reason of its own.** The proxy's private key is
// the row that must not survive a half-finished removal, so every step that
// can still fail belongs after it -- the mirror image of `pairing-service.ts`
// writing `own_key` first inside the pairing transaction.
//
// **`request_nonce` is deliberately absent**: it is the one child declared
// `Cascade`, so an expiring nonce can never block a removal, and deleting it
// here would be a second place to keep in step with the schema.
//
// **`installation_channel` is deliberately absent too**, and its absence from
// {@link RelationCascadeRepositories} is the guard rather than a comment: that
// table is per INSTALLATION, not per relation. Clearing it while unpairing one
// GROWI would refuse every notification aimed at the workspace's other paired
// GROWIs until the next inventory refresh (design.md 「`installation_channel`
// は消さない」). `InstallationStore.remove()` deletes it separately, because
// there the installation itself is going away.
import type {
  ChannelPermissionRepository,
  OwnKeyRepository,
  PeerKeyRepository,
  PendingCollectionRepository,
  ProcessedNotificationRepository,
  RelationRepository,
} from './repositories/index.js';

/**
 * The repositories one relation's removal touches, handed in rather than
 * constructed here (`.claude/rules/coding-style.md`, "executors take their
 * work-set as input") -- which is also what lets `InstallationStore` pass the
 * dependency object it already holds.
 */
export interface RelationCascadeRepositories {
  readonly relations: RelationRepository;
  readonly ownKeys: OwnKeyRepository;
  readonly peerKeys: PeerKeyRepository;
  readonly channelPermissions: ChannelPermissionRepository;
  readonly pendingCollections: PendingCollectionRepository;
  readonly processedNotifications: ProcessedNotificationRepository;
}

/**
 * Deletes `relationId`'s children and then the relation row itself.
 *
 * **Not atomic, and safe to call again.** The steps run in sequence rather
 * than inside one transaction, so a caller in a layer that holds no Prisma
 * client can still perform them. `Restrict` is what makes that acceptable: a
 * failure part-way through can leave a relation stripped of some children, but
 * it can never orphan a row, and the relation itself is still there to address
 * -- calling this again resumes and finishes the removal.
 *
 * **A relation that does not exist fails loudly.** The child deletions match
 * nothing and the final `relations.remove` rejects (Prisma reports the missing
 * row). Probing with a read first would only add a round trip and a window in
 * which the answer goes stale, and nothing harmful has happened by then.
 */
export const deleteRelationCascade = async (
  repositories: RelationCascadeRepositories,
  relationId: string,
): Promise<void> => {
  await repositories.ownKeys.deleteByRelation(relationId);
  await repositories.peerKeys.deleteByRelation(relationId);
  await repositories.channelPermissions.deleteByRelation(relationId);
  await repositories.pendingCollections.deleteByRelation(relationId);
  await repositories.processedNotifications.deleteByRelation(relationId);
  await repositories.relations.remove(relationId);
};
