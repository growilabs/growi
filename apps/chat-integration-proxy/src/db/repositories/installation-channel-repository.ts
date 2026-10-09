// The channels of one installation, refreshed periodically (design.md's
// `installation_channel` table). This is the only material the notification
// destination check reads -- design.md: 「判定は proxy が自分の周期で取り直して
// 保存した一覧だけを見る。通知が来たときには引きに行かない。」
//
// This file provides the storage primitives only. Deciding WHEN to refresh
// (the periodic pull, and the one-time refresh right after
// `InstallationStore.save()`) is `ChannelDirectory`'s job (`platform/channels.ts`,
// a later task) -- this repository just upserts one row at a time and answers
// two reads that decision needs.
//
// Per installation, not per relation: unpairing one relation must not remove
// rows here (design.md's unpairing sequence explicitly leaves this table
// alone), so there is no `deleteByRelation` -- there is no relation column to
// delete by in the first place.

import type { DbClient } from '../prisma-client.js';

export interface InstallationChannelRecord {
  readonly installationId: string;
  readonly platform: string;
  readonly channelId: string;
  readonly channelName: string;
  readonly isPrivate: boolean;
  readonly refreshedAt: Date;
}

export interface InstallationChannelRepository {
  /** Upserts one channel row, called in a loop by `ChannelDirectory` while it refreshes an installation's inventory. */
  upsert(channel: InstallationChannelRecord): Promise<void>;
  /**
   * Whether `(installationId, channelId)` is in the saved inventory -- the
   * primitive the notification destination check reads. No row here (and a
   * non-null `installation.channelsSyncedAt`) means `channel-not-in-installation`;
   * that judgement, and the `inventory-not-ready` case, belong to the caller.
   */
  find(
    installationId: string,
    channelId: string,
  ): Promise<InstallationChannelRecord | null>;
  /**
   * The whole saved inventory of one installation, in the order the database
   * returns it. Added for the `channels` endpoint (Requirements 2.2, 11.1),
   * which answers a GROWI with its own installation's channels and nothing
   * else -- the scoping is this `where` clause, not a filter applied after
   * reading, so no other tenant's rows are ever fetched.
   */
  listByInstallation(
    installationId: string,
  ): Promise<ReadonlyArray<InstallationChannelRecord>>;
  /**
   * Whether ANY channel is recorded for this installation. Combined with
   * `installation.channelsSyncedAt` (read via `installation-repository.ts`),
   * this is what lets a caller tell "never synced" apart from "synced, found
   * zero channels" -- deciding which of those two states applies is not this
   * repository's job.
   */
  existsAny(installationId: string): Promise<boolean>;
  /**
   * Deletes the whole saved inventory of an installation. Called only when the
   * installation itself is removed (`InstallationStore.remove()`), where
   * `installation_channel` -> `installation` being `Restrict` means the
   * installation row cannot go while these rows remain.
   *
   * **Not part of unpairing.** This table is per installation, not per
   * relation: clearing it when one relation is unpaired would refuse every
   * notification from the workspace's other GROWIs until the next refresh
   * (design.md: 「`installation_channel` は消さない」).
   */
  deleteByInstallation(installationId: string): Promise<number>;
}

const toRecord = (
  row: InstallationChannelRecord,
): InstallationChannelRecord => ({
  installationId: row.installationId,
  platform: row.platform,
  channelId: row.channelId,
  channelName: row.channelName,
  isPrivate: row.isPrivate,
  refreshedAt: row.refreshedAt,
});

export const createInstallationChannelRepository = (
  db: DbClient,
): InstallationChannelRepository => ({
  upsert: async (channel) => {
    await db.installationChannel.upsert({
      where: {
        installationId_channelId: {
          installationId: channel.installationId,
          channelId: channel.channelId,
        },
      },
      create: { ...channel },
      update: {
        platform: channel.platform,
        channelName: channel.channelName,
        isPrivate: channel.isPrivate,
        refreshedAt: channel.refreshedAt,
      },
    });
  },

  listByInstallation: async (installationId) => {
    const rows = await db.installationChannel.findMany({
      where: { installationId },
    });
    return rows.map(toRecord);
  },

  find: async (installationId, channelId) => {
    const row = await db.installationChannel.findUnique({
      where: { installationId_channelId: { installationId, channelId } },
    });
    return row == null ? null : toRecord(row);
  },

  existsAny: async (installationId) => {
    const row = await db.installationChannel.findFirst({
      where: { installationId },
      select: { installationId: true },
    });
    return row != null;
  },

  deleteByInstallation: async (installationId) => {
    const result = await db.installationChannel.deleteMany({
      where: { installationId },
    });
    return result.count;
  },
});
