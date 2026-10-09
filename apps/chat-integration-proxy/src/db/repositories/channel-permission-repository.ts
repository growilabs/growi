// Which channels may run one command, per relation (design.md's
// `channel_permission` table).
//
// No `scope` column and no per-row `updated_at`: the former follows from
// `COMMAND_TRAITS.targeting` (a later task's concern), and the latter is
// unnecessary because there is exactly one version per relation
// (`relation.settingsVersion`) -- see design.md's Data Models note on this
// table.
//
// **`link` must never get a row here.** design.md is explicit that the
// pairing-initiation command is not subject to channel-permission judgement
// (「`link` はチャンネル権限の判定に掛けない」) and that a `channel_permission`
// row for it must not be created later. This repository does not enforce
// that -- it is a caller-side invariant for whichever layer calls `upsert`
// with a `commandName`.
import type { DbClient } from '../prisma-client.js';

/**
 * What one stored row permits, in the same three values
 * `RelationSettings.allowedChannels` uses. `'all'` needs its own value
 * because neither of the other two can stand in for it: an empty list already
 * means "no channel permitted" (its exact opposite), and having no row at all
 * means `'no-settings'`, which `judge()` turns into a DENIAL for write
 * commands.
 *
 * `'none'` is deliberately absent: an empty list already produces the
 * identical verdict from `judge()`, so a second spelling of it would be two
 * representations of one state.
 */
export type PermittedChannels = ReadonlyArray<string> | 'all';

export interface ChannelPermissionRepository {
  /**
   * What is permitted for `(relationId, commandName)`, or `null` when no
   * row exists -- "no explicit restriction configured" (design.md's
   * `PermissionVerdict` reason `'no-settings'`), which a caller must not
   * conflate with an empty list (an explicit restriction to zero channels).
   */
  find(
    relationId: string,
    commandName: string,
  ): Promise<PermittedChannels | null>;
  /** Creates or replaces what is permitted for `(relationId, commandName)`. */
  upsert(
    relationId: string,
    commandName: string,
    channels: PermittedChannels,
  ): Promise<void>;
  /**
   * Deletes every row for a relation. Part of the unpairing sequence
   * (design.md: `own_key` / `peer_key` / `channel_permission` /
   * `pending_collection` / `processed_notification_target` are all deleted
   * before the `relation` row itself) -- composing that ordered sequence is
   * a later task's job; this is only the primitive.
   */
  deleteByRelation(relationId: string): Promise<number>;
}

export const createChannelPermissionRepository = (
  db: DbClient,
): ChannelPermissionRepository => ({
  find: async (relationId, commandName) => {
    const row = await db.channelPermission.findUnique({
      where: { relationId_commandName: { relationId, commandName } },
      select: { channels: true, allowAll: true },
    });
    if (row == null) {
      return null;
    }
    return row.allowAll ? 'all' : row.channels;
  },

  upsert: async (relationId, commandName, channels) => {
    // The list is emptied when the flag is set, so the two columns can never
    // disagree about what the row permits.
    const stored =
      channels === 'all'
        ? { channels: [], allowAll: true }
        : { channels: [...channels], allowAll: false };
    await db.channelPermission.upsert({
      where: { relationId_commandName: { relationId, commandName } },
      create: { relationId, commandName, ...stored },
      update: stored,
    });
  },

  deleteByRelation: async (relationId) => {
    const result = await db.channelPermission.deleteMany({
      where: { relationId },
    });
    return result.count;
  },
});
