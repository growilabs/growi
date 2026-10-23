// The form a channel id takes inside this proxy: the Chat SDK adapter's own
// encoding, i.e. what `Thread.channelId` is (`adapter.channelIdFromThreadId`),
// not the bare id a service's own API uses. Events arrive in that encoding and
// every outbound call (`ChannelImpl`, `decodeThreadId`, `fetchChannelMessages`)
// takes it back, so the one producer that reads a service's API directly --
// the channel inventory -- converts into it here. The inventory is what a
// command's channel, a channel permission and a notification target are all
// matched against, so a listed channel must carry the very id an event in it
// does (`channels.spec.ts` pins that against the real adapters).
//
// `ChannelRef.channelId` (`@growi/chat`) is a plain `string` shared with GROWI,
// so the brand below cannot travel past this layer; it guards the points where
// an id enters or leaves the SDK.
import type { ChannelRef, PlatformName } from '@growi/chat';

declare const sdkChannelIdBrand: unique symbol;

/** A channel id in the Chat SDK adapter's own encoding. */
export type SdkChannelId = string & { readonly [sdkChannelIdBrand]: true };

declare const teamsGraphChannelIdBrand: unique symbol;

/**
 * A Teams channel id as Microsoft Graph lists it. Not an `SdkChannelId`: the
 * Teams adapter's channel id also encodes the conversation's `serviceUrl`,
 * which only an incoming activity carries, so no listing can produce it.
 * Branded separately so this mismatch stays visible in the types rather than
 * being passed off as the SDK's encoding.
 */
export type TeamsGraphChannelId = string & {
  readonly [teamsGraphChannelIdBrand]: true;
};

/** An id the Chat SDK itself produced (`Thread.channelId`, `Channel.id`). */
export const sdkChannelIdFromAdapter = (channelId: string): SdkChannelId =>
  channelId as SdkChannelId;

/**
 * The id a `ChannelRef` carries, for handing back to the SDK. Every
 * `ChannelRef` names its channel by an SDK channel id: events are converted in
 * `event-mapping.ts`, the inventory by `INVENTORY_CHANNEL_IDS`, and GROWI only
 * names channels it was given by the inventory.
 */
export const sdkChannelIdOf = (channel: ChannelRef): SdkChannelId =>
  channel.channelId as SdkChannelId;

/**
 * How a channel id a service's list API returns becomes the id an event in
 * that channel carries. `workspaceId` is the installation's `workspace_id`.
 */
type InventoryChannelIdOf<Id> = (nativeId: string, workspaceId: string) => Id;

/**
 * One entry per service, each following what the installed adapter's
 * `channelIdFromThreadId` yields.
 */
export const INVENTORY_CHANNEL_IDS: {
  readonly [P in PlatformName]: InventoryChannelIdOf<
    P extends 'teams' ? TeamsGraphChannelId : SdkChannelId
  >;
} = {
  // `@chat-adapter/slack`: `slack:<channel>`.
  slack: (nativeId) => sdkChannelIdFromAdapter(`slack:${nativeId}`),
  // `@chat-adapter/discord`: `discord:<guild>:<channel>`, and a Discord
  // installation's workspace is its guild.
  discord: (nativeId, guildId) =>
    sdkChannelIdFromAdapter(`discord:${guildId}:${nativeId}`),
  // `chat-adapter-mattermost`: the bare channel id.
  mattermost: (nativeId) => sdkChannelIdFromAdapter(nativeId),
  // Unresolved: see `TeamsGraphChannelId`. A Teams inventory row therefore
  // does not match the channel id of a Teams event.
  teams: (nativeId) => nativeId as TeamsGraphChannelId,
};
