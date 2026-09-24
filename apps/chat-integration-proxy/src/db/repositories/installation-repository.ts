// Reading and writing the chat workspaces this proxy is installed into
// (design.md's `installation` table).
//
// The surface below is shaped by its two declared consumers in design.md:
// `InstallationProvider` (`resolve` / `list`) and `InstallationStore`
// (`save` / `remove`). Both live in `platform/`, one layer to the right, and
// both are written against workspace-level vocabulary rather than row ids --
// which is why `save` upserts on `(platform, workspaceId)` instead of taking
// an id, and why `resolveCredentials` is addressed the same way.
//
// `credentials` is the encrypted column. Every function below either encrypts
// on the way in or decrypts on the way out; no function returns the stored
// ciphertext, and no other layer is given the cipher's key (`SecretCipher` is
// two functions, see types/secret-cipher.ts).

import type { PlatformName } from '@growi/chat';

import type {
  InstallationCredentials,
  SecretCipher,
} from '../../types/index.js';
import type { DbClient } from '../prisma-client.js';

/**
 * One installation, without its credentials. Callers that need the credentials
 * ask for them explicitly (`resolveCredentials`) rather than receiving them on
 * every read -- a decrypted bot token should travel only where it is used.
 */
export interface InstallationRecord {
  readonly installationId: string;
  readonly platform: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly createdAt: Date;
  /** `null` means the channel inventory has never been refreshed. */
  readonly channelsSyncedAt: Date | null;
}

export interface InstallationRepository {
  /** Creates or updates the installation, and answers its id. */
  save(
    platform: PlatformName,
    workspaceId: string,
    workspaceName: string,
    credentials: InstallationCredentials,
  ): Promise<string>;
  /**
   * Deletes the installation row alone. The foreign keys onto `installation`
   * are `Restrict`, so this fails loudly while child rows exist rather than
   * orphaning them; ordering the child deletions is `InstallationStore.remove()`'s
   * job, one layer up, where the whole removal is a single unit of work.
   */
  remove(installationId: string): Promise<void>;
  findById(installationId: string): Promise<InstallationRecord | null>;
  findByWorkspace(
    platform: PlatformName,
    workspaceId: string,
  ): Promise<InstallationRecord | null>;
  /** What a service's always-on connection needs to know it serves. */
  listByPlatform(platform: PlatformName): Promise<
    ReadonlyArray<{
      readonly installationId: string;
      readonly workspaceId: string;
    }>
  >;
  resolveCredentials(
    platform: PlatformName,
    workspaceId: string,
  ): Promise<InstallationCredentials | null>;
  /**
   * Marks a full channel-inventory refresh (`listChannels()`) as complete,
   * regardless of whether it found any channels -- design.md: 「`channels_synced_at`
   * は…結果によらず（0 件でも）完了するたびに現在時刻を書く」. Deciding WHEN to
   * call this (the periodic refresh, and the one-time refresh right after
   * `save()`) is `ChannelDirectory`'s job, one layer up; this is only the
   * write primitive.
   */
  markChannelsSynced(installationId: string, syncedAt: Date): Promise<void>;
}

interface InstallationRow {
  readonly id: string;
  readonly platform: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly credentials: string;
  readonly createdAt: Date;
  readonly channelsSyncedAt: Date | null;
}

const toRecord = (row: InstallationRow): InstallationRecord => ({
  installationId: row.id,
  platform: row.platform,
  workspaceId: row.workspaceId,
  workspaceName: row.workspaceName,
  createdAt: row.createdAt,
  channelsSyncedAt: row.channelsSyncedAt,
});

export const createInstallationRepository = (
  db: DbClient,
  cipher: SecretCipher,
): InstallationRepository => ({
  save: async (platform, workspaceId, workspaceName, credentials) => {
    const encrypted = cipher.encrypt(JSON.stringify(credentials));
    const row = await db.installation.upsert({
      where: { platform_workspaceId: { platform, workspaceId } },
      create: {
        platform,
        workspaceId,
        workspaceName,
        credentials: encrypted,
      },
      // Deliberately narrow. Re-installing must not reset `channelsSyncedAt`:
      // that would make the whole workspace answer `inventory-not-ready` until
      // the next refresh, and design.md's channel-inventory section is explicit
      // that an empty inventory right after a save means every notification is
      // refused in the meantime.
      update: { workspaceName, credentials: encrypted },
    });
    return row.id;
  },

  remove: async (installationId) => {
    await db.installation.delete({ where: { id: installationId } });
  },

  findById: async (installationId) => {
    const row = await db.installation.findUnique({
      where: { id: installationId },
    });
    return row == null ? null : toRecord(row);
  },

  findByWorkspace: async (platform, workspaceId) => {
    const row = await db.installation.findUnique({
      where: { platform_workspaceId: { platform, workspaceId } },
    });
    return row == null ? null : toRecord(row);
  },

  listByPlatform: async (platform) => {
    const rows = await db.installation.findMany({
      where: { platform },
      select: { id: true, workspaceId: true },
    });
    return rows.map((row) => ({
      installationId: row.id,
      workspaceId: row.workspaceId,
    }));
  },

  resolveCredentials: async (platform, workspaceId) => {
    const row = await db.installation.findUnique({
      where: { platform_workspaceId: { platform, workspaceId } },
    });
    if (row == null) {
      return null;
    }
    // `decrypt` throws on a value that was altered in the database or written
    // under another key. That is deliberately not caught here: acting on
    // credentials that failed authentication is worse than failing the call.
    return JSON.parse(
      cipher.decrypt(row.credentials),
    ) as InstallationCredentials;
  },

  markChannelsSynced: async (installationId, syncedAt) => {
    await db.installation.update({
      where: { id: installationId },
      data: { channelsSyncedAt: syncedAt },
    });
  },
});
