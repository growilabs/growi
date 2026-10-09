// Creating and removing the chat workspaces this proxy serves -- design.md's
// `InstallationStore` (「installation を作る・消す」), the only way an
// installation comes into existence at all.
//
// **Two entry points, one function.** design.md gives `save()` two callers
// that arrive from opposite directions: the OAuth callback (Slack / Discord,
// `routes/install-routes.ts`) hands over credentials it has just exchanged,
// and the Mattermost startup reader (`runtime/mattermost-installations.ts`)
// hands over credentials an operator typed into a config file. Neither is
// built here. What is built here is what both of them call, which is why
// `save()` takes the finished `InstallationCredentials` and knows nothing
// about how they were obtained.
//
// **The immediate refresh is part of saving, not a courtesy.** design.md:
// 「`InstallationStore.save()` が成功した直後に 1 回取り直す。これが無いと、
// `installation_channel` が空のまま最初の周期を待つことになり、紐付けた直後の
// 10 分間、通知がすべて断られる」. The refresh is therefore awaited inside
// `save()` rather than left to the periodic sweep (tasks.md 9.2).
//
// **Nothing here reaches the database directly.** Every write goes through a
// repository handed in as a dependency (`.claude/rules/coding-style.md`,
// "executors take their work-set as input"), the same shape
// `ChannelRefreshDeps` uses in `channels.ts`, so `platform/` never names the
// Prisma client and this file is exercisable without a database.
import type { PlatformName } from '@growi/chat';

import type {
  ChannelPermissionRepository,
  InstallationChannelRepository,
  InstallationRepository,
  OwnKeyRepository,
  PairingOrderRepository,
  PeerKeyRepository,
  PendingCollectionRepository,
  ProcessedNotificationRepository,
  RelationRepository,
} from '../db/index.js';
import { deleteRelationCascade } from '../db/index.js';
import type { InstallationCredentials } from '../types/index.js';

/**
 * An immediate post-save channel refresh that did not complete.
 *
 * Carries the workspace as well as the id because the caller that reports this
 * is answering an operator who is looking at a workspace, not at a row id.
 */
export interface ChannelRefreshFailure {
  readonly installationId: string;
  readonly platform: PlatformName;
  readonly workspaceId: string;
  readonly error: unknown;
}

export interface InstallationStoreDeps {
  readonly installations: InstallationRepository;
  readonly relations: RelationRepository;
  readonly ownKeys: OwnKeyRepository;
  readonly peerKeys: PeerKeyRepository;
  readonly channelPermissions: ChannelPermissionRepository;
  readonly pendingCollections: PendingCollectionRepository;
  readonly processedNotifications: ProcessedNotificationRepository;
  readonly pairingOrders: PairingOrderRepository;
  readonly channels: InstallationChannelRepository;
  /**
   * The one-off refresh run right after a successful save --
   * `refreshChannelInventory` from `channels.ts`, already bound to its own
   * dependencies. Passed as a function rather than assembled here because
   * resolving an installation id to its platform and credentials is
   * `platform/index.ts`'s job (task 3.8), exactly as `ChannelRefreshDeps`
   * takes `listChannels`.
   */
  readonly refreshChannels: (installationId: string) => Promise<void>;
  /**
   * Called when that immediate refresh fails. **Required, not optional:** the
   * whole reason the refresh happens inside `save()` is that its absence is
   * felt by users, so a caller must decide what to do about a failure rather
   * than get silence by omission. This app has no logger of its own (nothing
   * in `src/` writes to one), so the report travels outward as a function the
   * caller supplies, like every other side effect in this layer.
   *
   * It must not throw: it runs on a path that has already succeeded, and
   * throwing there would fail a `save()` whose installation exists.
   */
  readonly onChannelRefreshFailed: (failure: ChannelRefreshFailure) => void;
}

export interface InstallationStore {
  /**
   * Creates or updates the installation for `(platform, workspaceId)`, takes
   * its channel inventory once, and answers the installation id.
   *
   * **A failed refresh does not fail the save.** The installation is what the
   * caller asked for and it exists; the inventory is caught up by the periodic
   * refresh (tasks.md 9.2), which is what that sweep is for. Rolling the
   * installation back instead would turn a transient listing error into a
   * failed installation an operator has to redo -- and for Slack and Discord
   * that means walking the whole OAuth flow again. The failure is reported
   * through `onChannelRefreshFailed` rather than swallowed, because until the
   * next sweep runs, notifications to this workspace are refused
   * (`inventory-not-ready`) and that is worth telling an operator about.
   */
  save(
    platform: PlatformName,
    workspaceId: string,
    workspaceName: string,
    credentials: InstallationCredentials,
  ): Promise<string>;
  /**
   * Removes an installation and everything that hangs off it -- the whole
   * workspace going away (the chat app was uninstalled), not one GROWI being
   * unpaired from it.
   *
   * Every foreign key onto `installation` and onto `relation` is `Restrict`
   * (schema.prisma, task 1.4: the database must not quietly cascade around the
   * order the application deletes in), so the sequence below is a
   * requirement, not a preference: a parent deleted before its children is
   * rejected outright.
   *
   * **Not atomic, and safe to call again.** The steps run in sequence rather
   * than inside one transaction, which keeps this layer free of the Prisma
   * client (only `db/` names it). `Restrict` is what makes that acceptable: a
   * failure part-way through can leave a relation stripped of its keys, but it
   * can never leave a row orphaned, and the installation row is still there to
   * address -- calling `remove()` again resumes and finishes the removal.
   */
  remove(installationId: string): Promise<void>;
}

export const createInstallationStore = (
  deps: InstallationStoreDeps,
): InstallationStore => ({
  save: async (platform, workspaceId, workspaceName, credentials) => {
    const installationId = await deps.installations.save(
      platform,
      workspaceId,
      workspaceName,
      credentials,
    );

    try {
      await deps.refreshChannels(installationId);
    } catch (error) {
      deps.onChannelRefreshFailed({
        installationId,
        platform,
        workspaceId,
        error,
      });
    }

    return installationId;
  },

  remove: async (installationId) => {
    const relations = await deps.relations.listByInstallation(installationId);

    for (const { relationId } of relations) {
      // Sequential per relation, and each relation finished before the next
      // one starts: `relation`'s children are `Restrict`, so the relation row
      // can only go once its own children have.
      //
      // The sequence itself is `db/relation-cascade.ts`, shared with
      // `UnpairService` (task 5.5) so that the order -- which the database
      // enforces and which puts the private key first -- is written down once.
      // `deps` carries more repositories than it needs; the extra ones are
      // installation-scoped and handled below.
      // biome-ignore lint/performance/noAwaitInLoops: the deletions are ordered by the foreign keys, so they cannot run concurrently
      await deleteRelationCascade(deps, relationId);
    }

    // Installation-scoped children next. `pairing_order` -> `installation` is
    // `Restrict`, so orders block the installation row even though their
    // `relation_id` was nulled by the relation deletions above.
    await deps.pairingOrders.deleteByInstallation(installationId);
    // Unlike unpairing, which must leave this table alone (it is per
    // installation, and clearing it would refuse the workspace's other GROWIs'
    // notifications until the next refresh), the installation itself is going
    // away here, so its saved inventory goes with it.
    await deps.channels.deleteByInstallation(installationId);

    await deps.installations.remove(installationId);
  },
});
