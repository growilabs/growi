// Task 9.3: the channel list every screen that PICKS a notification
// destination reads (Requirement 2.2) -- the admin settings screen
// (`admin/notification-destinations.ts`) and the page-save picker
// (`notification/save-time-channels.ts`) -- and the one place where a
// stored destination's `channelName` is brought back up to date.
//
// It sits beside `proxy-client.ts` rather than inside `admin/` because
// both of those callers need it and only one of them is an admin screen.
//
// Why the refresh belongs here rather than in the screen or the save:
// `channelName` exists ONLY to be displayed and to answer Requirement
// 12.4's overlap question (see `chat-notification-destination.ts` and
// `channel-name-overlap.ts`), and a channel can be renamed in the chat
// service at any time with nothing telling GROWI. A stale name makes the
// overlap warning appear when it should not, or -- worse -- stay silent
// when it should not. The inventory fetch is the only moment GROWI learns
// the current names, so design.md pins the refresh to it ("`ChannelInventory`
// を引いたときに合わせて更新する"). Every caller that fetches the inventory
// therefore goes through `loadChannelInventory`, never `fetchChannels`
// directly.
//
// KNOWN GAP (not addressed here): only a channel that IS in the fetched
// list can be refreshed. A destination whose channel has dropped out of
// the inventory -- the bot was removed from it, or it is private and the
// proxy's key can no longer see it -- keeps whatever name it was stored
// with, indefinitely. If Gen 1 is later pointed at a channel with that old
// name, Requirement 12.4's overlap check compares against the abandoned
// name and stays silent about a collision that is real. Deciding what to
// do about it (drop the name, mark the row as unverified, warn about the
// disappearance) changes what `channelName` means, which is a design
// decision rather than a local fix.

import type { ChannelInventory } from '@growi/chat';

import loggerFactory from '~/utils/logger';

import { ChatNotificationDestination } from './models/chat-notification-destination';
import { fetchChannels, type ProxyCallResult } from './proxy-client';

const logger = loggerFactory(
  'growi:features:chat-integration:channel-inventory',
);

/**
 * Brings every stored destination of this relation in line with the names
 * the chat service currently reports, matching rows BY IDENTIFIER
 * (`channelId`) -- the only field a channel keeps for its whole life.
 *
 * Takes the channel list as an argument instead of fetching it, so the
 * refresh is exercisable against any inventory and the fetch stays the
 * caller's decision (`.claude/rules/coding-style.md`, "Executors Take Their
 * Work-Set as Input").
 *
 * No transaction: each row is an independent, idempotent correction of one
 * display value, so there is no state that two of these could leave
 * half-applied.
 *
 * The work is driven by THIS RELATION'S OWN DESTINATIONS, not by the
 * fetched channel list, and that direction matters for cost. A workspace
 * can report thousands of channels while a relation has a handful of
 * destinations, and `chat_notification_destinations` carries no index (see
 * that model's closing note), so one write per fetched channel would mean
 * one full collection scan per channel on every screen load. Reading the
 * relation's own rows first is a single query, and only the rows whose
 * stored name actually differs are written -- a screen load that changes
 * nothing writes nothing at all.
 *
 * @returns how many stored destinations had a stale name.
 */
export const refreshDestinationChannelNames = async (
  relationId: string,
  channels: ChannelInventory['channels'],
): Promise<number> => {
  if (channels.length === 0) {
    return 0;
  }

  const currentNameById = new Map(
    channels.map((channel) => [channel.channelId, channel.channelName]),
  );

  const storedRows = await ChatNotificationDestination.find({ relationId })
    .select({ channelId: 1, channelName: 1 })
    .lean();

  // One entry per stale CHANNEL, not per stale row: several destinations
  // can share a channel (different path patterns), and one `updateMany`
  // per channel corrects all of them.
  const staleNameByChannelId = new Map<string, string>();
  for (const row of storedRows) {
    const currentName = currentNameById.get(row.channelId);
    // A channel missing from the fetched list keeps its stored name -- see
    // this module's note above on what that leaves behind.
    if (currentName != null && currentName !== row.channelName) {
      staleNameByChannelId.set(row.channelId, currentName);
    }
  }

  if (staleNameByChannelId.size === 0) {
    return 0;
  }

  const result = await ChatNotificationDestination.bulkWrite(
    [...staleNameByChannelId].map(([channelId, channelName]) => ({
      updateMany: {
        filter: { relationId, channelId },
        update: { $set: { channelName } },
      },
    })),
  );

  const refreshedCount = result.modifiedCount;
  if (refreshedCount > 0) {
    logger.info(
      `Refreshed the stored channel name of ${refreshedCount} notification destination(s) of relation '${relationId}'.`,
    );
  }
  return refreshedCount;
};

/**
 * Fetches this relation's channel list from the proxy and, on success,
 * refreshes the stored destination names from it.
 *
 * A refresh that fails does not turn a successful fetch into a failure: the
 * caller asked for the channel list, the channel list arrived, and the
 * names it stores are a display/warning aid rather than the answer. The
 * failure is logged and the next screen load tries again.
 */
export const loadChannelInventory = async (
  relationId: string,
): Promise<ProxyCallResult<ChannelInventory>> => {
  const result = await fetchChannels(relationId);
  if (!result.ok) {
    return result;
  }

  try {
    await refreshDestinationChannelNames(relationId, result.response.channels);
  } catch (err) {
    logger.warn(
      `Could not refresh the stored channel names of relation '${relationId}'; the channel list itself was fetched successfully.`,
      err,
    );
  }

  return result;
};
