// Pure channel-permission judgement shared by both sides of the integration
// (Requirement 11: channel-scoped command permission). See design.md
// "ChannelPermission -- 両側が使う純粋関数" for the full rationale.
//
// These functions read only their arguments -- no DB, no clock -- because
// the whole reason this module exists is that GROWI (which persists
// RelationSettings) and the proxy (which enforces it per incoming command)
// must compute the identical verdict from the identical inputs.

import { type CommandName, isWriteCommand } from '../commands/command-names.js';
import type { ChannelRef } from '../contract/common.js';
import type { RelationSettings } from '../contract/settings.js';

export type PermissionVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: 'not-permitted-in-channel' | 'no-settings';
    };

/**
 * Judgement against a single relation (Req 11.1, 11.3, 11.5).
 *
 * Default rule -- these two inputs MUST produce the same verdict:
 *   1. `settings` is `null` (this relation never received a settings push)
 *   2. `settings` exists but has no row for `commandName` in
 *      `channelPermissions` (the normal state right after a new command name
 *      is added to COMMAND_NAMES -- existing relations' stored settings
 *      won't have a row for it yet)
 * In both cases: write commands are denied (`no-settings`); everything else
 * is allowed. Leaving either of these two undecided would mean this
 * function -- whose only reason to exist is "both sides agree" -- has no
 * single answer for a perfectly ordinary data shape.
 */
export const judge = (
  settings: RelationSettings | null,
  commandName: CommandName,
  channel: ChannelRef,
): PermissionVerdict => {
  const row = settings?.channelPermissions.find(
    (permission) => permission.commandName === commandName,
  );

  if (row == null) {
    return isWriteCommand(commandName)
      ? { allowed: false, reason: 'no-settings' }
      : { allowed: true };
  }

  if (row.allowedChannels === 'all') {
    return { allowed: true };
  }

  if (row.allowedChannels === 'none') {
    return { allowed: false, reason: 'not-permitted-in-channel' };
  }

  // Match by channelId ONLY -- channelName is display-only and may be
  // renamed on the chat platform (Requirement 11.3).
  return row.allowedChannels.includes(channel.channelId)
    ? { allowed: true }
    : { allowed: false, reason: 'not-permitted-in-channel' };
};

/** For a broadcast-target command, narrow down which GROWI instances may receive it (Req 11.2) */
export interface BroadcastTarget {
  readonly relationId: string;
  readonly verdict: PermissionVerdict;
}

/**
 * For a broadcast-target command, narrow down which peers may receive it
 * (Req 11.2). Judges each relation independently -- never an all-or-nothing
 * aggregate, so one relation's missing settings never blocks the rest, and
 * one relation's blanket allowance never leaks the command to a relation
 * that hasn't allowed it.
 *
 * ALWAYS returns the excluded relations too, WITH their reason -- Req 11.3
 * and a later task's FanOutOutcome.excluded require "show the user who
 * didn't get it". Returning only the allowed subset would drop the reason.
 */
export const filterBroadcastTargets = (
  settingsByRelation: ReadonlyArray<{
    relationId: string;
    settings: RelationSettings | null;
  }>,
  commandName: CommandName,
  channel: ChannelRef,
): ReadonlyArray<BroadcastTarget> =>
  settingsByRelation.map(({ relationId, settings }) => ({
    relationId,
    verdict: judge(settings, commandName, channel),
  }));
