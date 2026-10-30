// Task 9.3: the administrator's view of one relation's Gen 2 notification
// destinations, and how a destination is saved.
//
// Two rules shape this whole file:
//
//   1. A destination is chosen BY IDENTIFIER (Requirement 2.2). The save
//      accepts a `channelId` and nothing else about the channel: the name
//      stored alongside it is taken from the inventory the proxy just
//      answered with, never from the request. So a channel that is not in
//      the fetched list cannot be saved at all, and no request can invent
//      a name for a real channel.
//   2. The overlap warning (Requirement 12.4) is computed against FRESHLY
//      refreshed names WHENEVER THE CHANNEL LIST COULD BE FETCHED.
//      `loadChannelInventory` refreshes the stored names before the
//      destinations are read here, so the comparison does not run on a
//      name the chat service has since changed. When the fetch fails there
//      is nothing to refresh from; the comparison still runs on the stored
//      names, and `overlapsMayBeStale` tells the screen that its answer is
//      provisional.
//
// Gen 1's destinations are passed in rather than read here -- see
// `gen1-slack-channel-names.ts` for why the Gen 1 read stays at the router
// boundary, and `channel-name-overlap.ts` for why the comparison is by name.

import type { ChannelInventory } from '@growi/chat';

import { GlobalNotificationSettingEvent } from '~/server/models/GlobalNotificationSetting/consts';

import { loadChannelInventory } from '../channel-inventory';
import { ChatNotificationDestination } from '../models/chat-notification-destination';
import { ChatRelation } from '../models/chat-relation';
import {
  type ChannelNameOverlap,
  findChannelNameOverlaps,
} from './channel-name-overlap';

const PATH_PATTERN_MAX_LENGTH = 500;
const CHANNEL_ID_MAX_LENGTH = 200;

/**
 * The event names a destination may subscribe to. Gen 1's own vocabulary is
 * reused rather than restated, so a destination can only ever ask for an
 * event that is actually emitted (the same reason
 * `content/notification-content.ts` reads this const).
 */
const TRIGGER_EVENT_VALUES: ReadonlyArray<string> = Object.values(
  GlobalNotificationSettingEvent,
);

export interface AdminNotificationDestination {
  readonly platform: string;
  readonly channelId: string;
  readonly channelName: string;
  readonly pathPattern: string;
  readonly triggerEvents: readonly string[];
}

export interface AdminNotificationDestinationsView {
  readonly destinations: readonly AdminNotificationDestination[];
  /** The channels an administrator may pick from; empty when the proxy could not be reached. */
  readonly channels: ChannelInventory['channels'];
  /** Why `channels` is empty, or `null` when the list was fetched. */
  readonly channelsUnavailable: string | null;
  /** Requirement 12.4: destinations that Gen 1 also posts to. */
  readonly overlaps: readonly ChannelNameOverlap[];
  /**
   * Whether `overlaps` was decided WITHOUT the stored names having been
   * brought up to date first -- true exactly when the channel list could
   * not be fetched.
   *
   * The overlap check still runs in that state, because the destinations
   * and Gen 1's channel list both come from GROWI's own database and a
   * warning it can still produce is worth showing. But an EMPTY result
   * then means "nothing overlaps according to names the chat service may
   * have abandoned", which is not the same as "nothing overlaps" -- and
   * the difference is invisible on screen unless it is stated. Requirement
   * 12.4 errs toward warning rather than toward silence, so the screen is
   * told that the answer is provisional.
   */
  readonly overlapsMayBeStale: boolean;
}

const readDestinations = async (
  relationId: string,
): Promise<AdminNotificationDestination[]> => {
  const rows = await ChatNotificationDestination.find({ relationId })
    .sort({ channelName: 1, pathPattern: 1 })
    .lean();

  return rows.map((row) => ({
    platform: row.platform,
    channelId: row.channelId,
    channelName: row.channelName,
    pathPattern: row.pathPattern,
    triggerEvents: row.triggerEvents,
  }));
};

/**
 * Everything the destination editor needs in ONE round trip: the channel
 * list to pick from, what is configured now, and which of those overlap
 * with Gen 1.
 *
 * It is a single call on purpose. Fetching the channel list separately
 * would leave the two halves ordered by chance, and the overlap warning
 * would then be computed from names the refresh had not reached yet -- the
 * exact staleness design.md ties the refresh to the fetch to avoid.
 *
 * A proxy that cannot be reached does not empty the screen: what is already
 * configured, and the warnings about it, are read from GROWI's own
 * database and still shown. Only the picker goes away, with a reason
 * (`channelsUnavailable`) -- and with it the ability to add a destination,
 * which is correct, since a destination may only be chosen from a list the
 * chat service confirmed.
 */
export const buildNotificationDestinationsView = async (
  relationId: string,
  gen1ChannelNames: readonly string[],
): Promise<AdminNotificationDestinationsView> => {
  const inventory = await loadChannelInventory(relationId);
  const destinations = await readDestinations(relationId);

  return {
    destinations,
    channels: inventory.ok ? inventory.response.channels : [],
    channelsUnavailable: inventory.ok ? null : inventory.reason,
    overlaps: findChannelNameOverlaps(destinations, gen1ChannelNames),
    overlapsMayBeStale: !inventory.ok,
  };
};

export type SaveNotificationDestinationOutcome =
  | {
      readonly status: 'saved';
      readonly destination: AdminNotificationDestination;
    }
  | { readonly status: 'invalid-destination'; readonly detail: string }
  | { readonly status: 'relation-not-found' }
  /** The channel id is not in the list the chat service reports for this relation. */
  | { readonly status: 'unknown-channel'; readonly detail: string }
  /** The channel list could not be fetched, so no id can be confirmed. */
  | { readonly status: 'channels-unavailable'; readonly reason: string };

interface ParsedDestinationInput {
  readonly channelId: string;
  readonly pathPattern: string;
  readonly triggerEvents: readonly string[];
}

type ParseResult =
  | { readonly ok: true; readonly input: ParsedDestinationInput }
  | { readonly ok: false; readonly detail: string };

const parseDestinationInput = (raw: unknown): ParseResult => {
  if (typeof raw !== 'object' || raw == null || Array.isArray(raw)) {
    return { ok: false, detail: 'the request body must be an object' };
  }
  const { channelId, pathPattern, triggerEvents } = raw as {
    readonly channelId?: unknown;
    readonly pathPattern?: unknown;
    readonly triggerEvents?: unknown;
  };

  if (
    typeof channelId !== 'string' ||
    channelId.length === 0 ||
    channelId.length > CHANNEL_ID_MAX_LENGTH
  ) {
    return {
      ok: false,
      detail:
        "'channelId' must be the identifier of a channel from this relation's channel list",
    };
  }
  if (
    typeof pathPattern !== 'string' ||
    !pathPattern.startsWith('/') ||
    pathPattern.length > PATH_PATTERN_MAX_LENGTH
  ) {
    return {
      ok: false,
      detail: `'pathPattern' must be a page path starting with '/' (at most ${PATH_PATTERN_MAX_LENGTH} characters)`,
    };
  }
  if (!Array.isArray(triggerEvents) || triggerEvents.length === 0) {
    return {
      ok: false,
      detail: "'triggerEvents' must list at least one event",
    };
  }
  const unknownEvent = triggerEvents.find(
    (event) =>
      typeof event !== 'string' || !TRIGGER_EVENT_VALUES.includes(event),
  );
  if (unknownEvent !== undefined) {
    return {
      ok: false,
      detail: `unknown triggerEvent: ${String(unknownEvent)}`,
    };
  }

  return {
    ok: true,
    input: {
      channelId,
      pathPattern,
      triggerEvents: [...new Set(triggerEvents as string[])],
    },
  };
};

/**
 * Saves one destination: this relation posts the given events for pages
 * under the given path to the channel with the given IDENTIFIER.
 *
 * `(relationId, channelId, pathPattern)` identifies a destination, so
 * saving the same channel and path again replaces which events it receives
 * instead of accumulating near-duplicate rows an administrator cannot tell
 * apart on screen.
 *
 * No transaction: one row is written, and the name refresh that precedes it
 * is an idempotent correction of a display value (see
 * `channel-inventory.ts`) -- there is no pair of writes that could be left
 * half-applied.
 */
export const saveNotificationDestination = async (
  relationId: string,
  raw: unknown,
): Promise<SaveNotificationDestinationOutcome> => {
  const parsed = parseDestinationInput(raw);
  if (!parsed.ok) {
    return { status: 'invalid-destination', detail: parsed.detail };
  }
  const { channelId, pathPattern, triggerEvents } = parsed.input;

  const relation = await ChatRelation.findOne({ relationId, state: 'active' });
  if (relation == null) {
    return { status: 'relation-not-found' };
  }

  const inventory = await loadChannelInventory(relationId);
  if (!inventory.ok) {
    return { status: 'channels-unavailable', reason: inventory.reason };
  }

  // The channel's name and platform come from here, never from the
  // request: the identifier is the only thing the administrator chose.
  const channel = inventory.response.channels.find(
    (candidate) => candidate.channelId === channelId,
  );
  if (channel == null) {
    return {
      status: 'unknown-channel',
      detail: `Channel '${channelId}' is not one of the channels this relation can post to`,
    };
  }

  await ChatNotificationDestination.updateOne(
    { relationId, channelId, pathPattern },
    {
      $set: {
        platform: channel.platform,
        channelName: channel.channelName,
        triggerEvents: [...triggerEvents],
      },
    },
    { upsert: true },
  );

  return {
    status: 'saved',
    destination: {
      platform: channel.platform,
      channelId: channel.channelId,
      channelName: channel.channelName,
      pathPattern,
      triggerEvents,
    },
  };
};
