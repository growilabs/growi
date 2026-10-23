// How this proxy names a channel internally, as opposed to on the protocol.
//
// A channel has two ids. The chat service's own (`C0CBFQ5558V` on Slack) is
// what an administrator types and what every protocol field carries
// (`@growi/chat`'s `NativeChannelId`). The Chat SDK adapter's encoding of it
// (`slack:C0CBFQ5558V`, `discord:<guild>:<channel>`) is what events arrive in
// and what every outbound call takes back, so it is the form used everywhere
// inside this proxy. Giving each its own brand keeps the two from being
// compared with each other; the only module that converts between them is
// `capabilities/channel-id.ts`.
import type { ChannelRef, PlatformName } from '@growi/chat';

declare const sdkChannelIdBrand: unique symbol;

/** A channel id in the Chat SDK adapter's own encoding (`Thread.channelId`). */
export type SdkChannelId = string & { readonly [sdkChannelIdBrand]: true };

declare const teamsGraphChannelIdBrand: unique symbol;

/**
 * A Teams channel id as Microsoft Graph lists it. Not an `SdkChannelId`: the
 * Teams adapter's channel id also encodes the conversation's `serviceUrl`,
 * which only an incoming activity carries, so no listing can produce it.
 */
export type TeamsGraphChannelId = string & {
  readonly [teamsGraphChannelIdBrand]: true;
};

/** `ChannelRef`, named the way this proxy addresses the channel. */
export interface SdkChannelRef extends Omit<ChannelRef, 'channelId'> {
  readonly channelId: SdkChannelId;
}

/** `MessageRef`, on an `SdkChannelRef`. */
export interface SdkMessageRef {
  readonly channel: SdkChannelRef;
  readonly messageId: string;
}

type InventoryChannelIds = {
  readonly [P in PlatformName]: P extends 'teams'
    ? TeamsGraphChannelId
    : SdkChannelId;
};

/** The id a saved inventory row carries on each service. */
export type InventoryChannelId<P extends PlatformName = PlatformName> =
  InventoryChannelIds[P];

/** One channel of an installation's inventory, on service `P`. */
export interface InventoryChannelOf<P extends PlatformName> {
  readonly platform: P;
  readonly channelId: InventoryChannelId<P>;
  readonly channelName: string;
  readonly isPrivate: boolean;
}

/**
 * One channel of an installation's inventory. Discriminated by `platform`, so
 * that only a Teams row can hold an id this proxy cannot post to.
 */
export type InventoryChannel = {
  readonly [P in PlatformName]: InventoryChannelOf<P>;
}[PlatformName];

/** An installation's channels, as a lister takes them from the service. */
export interface ChannelListing {
  readonly channels: ReadonlyArray<InventoryChannel>;
}
