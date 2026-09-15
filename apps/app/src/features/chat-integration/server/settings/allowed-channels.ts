// The single place that knows how `RelationSettings.channelPermissions[]
// .allowedChannels` -- `'all'` | `'none'` | an explicit channel-id list --
// is laid out in `chat_channel_permissions`.
//
// Why it is a module of its own: both directions are needed by two
// different callers (the admin save flow writes, `settings-pull` reads), and
// if either side inlined the encoding, a change to one would quietly stop
// matching the other. Requirement 11.1's whole point is that both sides of
// the integration agree on what a channel permission says.

import type { RelationSettings } from '@growi/chat';

import type {
  ChatChannelPermissionScope,
  IChatChannelPermission,
} from './models/chat-channel-permission';

/** The wire form: what the proxy sends and receives. */
export type WireAllowedChannels =
  RelationSettings['channelPermissions'][number]['allowedChannels'];

/** The stored form: see `ChatChannelPermissionScope` for why it is two fields. */
export type StoredAllowedChannels = Pick<
  IChatChannelPermission,
  'channelScope' | 'allowedChannels'
>;

export const toStoredAllowedChannels = (
  wire: WireAllowedChannels,
): StoredAllowedChannels => {
  if (wire === 'all' || wire === 'none') {
    // No id list is kept for these: a row switched away from an explicit
    // list must not leave stale ids behind for a later reader to pick up.
    return { channelScope: wire, allowedChannels: [] };
  }
  return { channelScope: 'listed', allowedChannels: [...wire] };
};

export const toWireAllowedChannels = (stored: {
  // Optional because a row written before `channelScope` existed has no
  // value for it; `'listed'` is the reading that preserves its meaning.
  readonly channelScope?: ChatChannelPermissionScope;
  readonly allowedChannels?: ReadonlyArray<string>;
}): WireAllowedChannels => {
  if (stored.channelScope === 'all' || stored.channelScope === 'none') {
    return stored.channelScope;
  }
  return [...(stored.allowedChannels ?? [])];
};
