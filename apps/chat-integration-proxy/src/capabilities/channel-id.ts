// The one place a channel's two ids meet (see `types/channel.ts`): the chat
// service's own id, which every protocol field carries, and the Chat SDK
// adapter's encoding of it, which this proxy uses internally.
//
// - Outward (to GROWI) every id is converted here, so a field GROWI reads can
//   only hold the id an administrator would type.
// - Inward, the only ids GROWI names are notification targets, and those are
//   resolved against the installation's saved inventory rather than encoded:
//   the inventory row already carries the SDK id (with the Discord guild a bare
//   id lacks), and a channel outside the inventory may not be posted to anyway.
// - Every id read back from storage is re-validated here, so a stored value
//   that is not in the form its column holds never acquires that brand.
//
// In `capabilities/` rather than `platform/` because `db/`, which sits to the
// left of `platform/`, needs the validating constructors.
import {
  type ChannelInventory,
  type ChannelRef,
  type NativeChannelId,
  type PlatformName,
  parseNativeChannelId,
  toNativeChannelId,
} from '@growi/chat';

import type {
  InventoryChannel,
  InventoryChannelId,
  InventoryChannelOf,
  SdkChannelId,
  SdkChannelRef,
  TeamsGraphChannelId,
} from '../types/index.js';

/** Far above any adapter's encoding; only refuses a value that is not an id at all. */
const SDK_CHANNEL_ID_MAX = 1000;

/**
 * How one service's adapter encodes a channel id: the shape `channelIdFromThreadId`
 * yields, with the service's own id in capture group 1 (as `decodeNative` reads it).
 * `platform/channels.spec.ts` pins each entry against the installed adapter.
 */
interface SdkChannelIdFormat {
  readonly shape: RegExp;
  readonly decodeNative: (captured: string) => string;
}

const asIs = (captured: string): string => captured;

const SDK_CHANNEL_ID_FORMATS: Readonly<
  Record<PlatformName, SdkChannelIdFormat>
> = {
  // `@chat-adapter/slack`: `slack:<channel>`.
  slack: { shape: /^slack:([^:]+)$/, decodeNative: asIs },
  // `@chat-adapter/discord`: `discord:<guild>:<channel>` (`@me` as the guild of
  // a DM). A slash command typed in a thread names `Channel.id` with the
  // thread as a fourth segment; the channel the service shows is the parent.
  discord: { shape: /^discord:[^:]+:([^:]+)(?::[^:]+)?$/, decodeNative: asIs },
  // `@chat-adapter/teams`: `teams:<base64url conversation id>:<base64url
  // serviceUrl>[:<conversation type>]`. A channel's conversation id, stripped
  // of `;messageid=` as `channelIdFromThreadId` does, is the id Graph lists.
  teams: {
    shape:
      /^teams:([A-Za-z0-9_-]+):[A-Za-z0-9_-]+(?::(?:channel|groupChat|personal))?$/,
    decodeNative: (captured) =>
      Buffer.from(captured, 'base64url').toString('utf8'),
  },
  // `chat-adapter-mattermost`: the bare channel id.
  mattermost: { shape: /^([^:]+)$/, decodeNative: asIs },
};

const isPlatformName = (value: string): value is PlatformName =>
  Object.hasOwn(SDK_CHANNEL_ID_FORMATS, value);

const nativeIdInside = (
  platform: PlatformName,
  value: string,
): NativeChannelId | undefined => {
  const format = SDK_CHANNEL_ID_FORMATS[platform];
  const captured =
    value.length > SDK_CHANNEL_ID_MAX
      ? undefined
      : format.shape.exec(value)?.[1];
  return captured === undefined
    ? undefined
    : parseNativeChannelId(format.decodeNative(captured));
};

// ---------------------------------------------------------------------------
// The SDK form
// ---------------------------------------------------------------------------

/**
 * `undefined` unless `value` is a channel id in `platform`'s adapter encoding
 * that holds a valid service id -- so every `SdkChannelId` obtained here can be
 * told to GROWI.
 */
export const parseSdkChannelId = (
  platform: string,
  value: string,
): SdkChannelId | undefined =>
  isPlatformName(platform) && nativeIdInside(platform, value) !== undefined
    ? (value as SdkChannelId)
    : undefined;

/** For a value the caller already expects to be valid; throws otherwise. */
export const toSdkChannelId = (
  platform: PlatformName,
  value: string,
): SdkChannelId => {
  const id = parseSdkChannelId(platform, value);
  if (id === undefined) {
    throw new TypeError(`Not a ${platform} Chat SDK channel id: ${value}`);
  }
  return id;
};

/**
 * An id the Chat SDK itself just produced (`Thread.channelId`, `Channel.id`),
 * taken as it is: the adapter is the authority on its own encoding.
 */
export const sdkChannelIdFromAdapter = (channelId: string): SdkChannelId =>
  channelId as SdkChannelId;

/**
 * The chat service's own id of a channel this proxy addresses. Throws when the
 * id is not in `platform`'s encoding, so a mismatch surfaces where the id is
 * about to leave the proxy rather than as a refusal inside GROWI.
 */
export const nativeChannelIdOf = (channel: {
  readonly platform: PlatformName;
  readonly channelId: SdkChannelId;
}): NativeChannelId => {
  const native = nativeIdInside(channel.platform, channel.channelId);
  if (native === undefined) {
    throw new TypeError(
      `Not a ${channel.platform} Chat SDK channel id: ${channel.channelId}`,
    );
  }
  return native;
};

/** The protocol's view of a channel: the same channel, named by its own id. */
export const toProtocolChannelRef = (channel: SdkChannelRef): ChannelRef => ({
  ...channel,
  channelId: nativeChannelIdOf(channel),
});

// ---------------------------------------------------------------------------
// Teams channels as Graph lists them
// ---------------------------------------------------------------------------

/** A Graph channel id is already the service's own id. */
const parseTeamsGraphChannelId = (
  value: string,
): TeamsGraphChannelId | undefined =>
  parseNativeChannelId(value) === undefined
    ? undefined
    : (value as TeamsGraphChannelId);

export const toTeamsGraphChannelId = (value: string): TeamsGraphChannelId => {
  const id = parseTeamsGraphChannelId(value);
  if (id === undefined) {
    throw new TypeError(`Not a Teams channel id: ${value}`);
  }
  return id;
};

// ---------------------------------------------------------------------------
// The saved inventory
// ---------------------------------------------------------------------------

/** What identifies a saved inventory row, without the display fields. */
export type InventoryChannelKey = {
  readonly [P in PlatformName]: Pick<
    InventoryChannelOf<P>,
    'platform' | 'channelId'
  >;
}[PlatformName];

/** Per service: how an inventory row's id is read, told to GROWI, and posted to. */
interface InventoryIdFormat<Id> {
  /**
   * The row id for a channel the service's own list API returned. Uses the
   * installation's `workspace_id` where the adapter encodes it (Discord's guild).
   */
  readonly fromListed: (
    listedId: string,
    workspaceId: string,
  ) => Id | undefined;
  /** The row id of the channel an event names, for finding the event's installation. */
  readonly ofEvent: (id: SdkChannelId) => Id;
  readonly parseKey: (value: string) => InventoryChannelKey | undefined;
  readonly nativeOf: (id: Id) => NativeChannelId;
  /** `undefined` when the row's id cannot address the channel for posting. */
  readonly addressOf: (id: Id) => SdkChannelId | undefined;
}

type SdkInventoryPlatform = Exclude<PlatformName, 'teams'>;

const sdkInventoryFormat = (
  platform: SdkInventoryPlatform,
  encodeListed: (listedId: string, workspaceId: string) => string,
  channelLevel: (channelId: SdkChannelId) => SdkChannelId = (channelId) =>
    channelId,
): InventoryIdFormat<SdkChannelId> => ({
  fromListed: (listedId, workspaceId) =>
    parseSdkChannelId(platform, encodeListed(listedId, workspaceId)),
  ofEvent: channelLevel,
  parseKey: (value) => {
    const channelId = parseSdkChannelId(platform, value);
    return channelId === undefined ? undefined : { platform, channelId };
  },
  nativeOf: (channelId) => nativeChannelIdOf({ platform, channelId }),
  addressOf: (channelId) => channelId,
});

const INVENTORY_ID_FORMATS: {
  readonly [P in PlatformName]: InventoryIdFormat<InventoryChannelId<P>>;
} = {
  slack: sdkInventoryFormat('slack', (listedId) => `slack:${listedId}`),
  discord: sdkInventoryFormat(
    'discord',
    (listedId, guildId) => `discord:${guildId}:${listedId}`,
    // Drops a thread segment, as the adapter's `channelIdFromThreadId` does.
    (channelId) =>
      toSdkChannelId('discord', channelId.split(':').slice(0, 3).join(':')),
  ),
  mattermost: sdkInventoryFormat('mattermost', (listedId) => listedId),
  // See `TeamsGraphChannelId`: a listed Teams channel is matched against by its
  // own id, but cannot be posted to without the `serviceUrl` only an event has.
  teams: {
    fromListed: (listedId) => parseTeamsGraphChannelId(listedId),
    ofEvent: (channelId) =>
      toTeamsGraphChannelId(
        nativeChannelIdOf({ platform: 'teams', channelId }),
      ),
    parseKey: (value) => {
      const channelId = parseTeamsGraphChannelId(value);
      return channelId === undefined
        ? undefined
        : { platform: 'teams', channelId };
    },
    nativeOf: (id) => toNativeChannelId(id),
    addressOf: () => undefined,
  },
};

/** The id a lister stores for a channel the service's list API returned. */
export const inventoryChannelIdOfListed = <P extends PlatformName>(
  platform: P,
  listedId: string,
  workspaceId: string,
): InventoryChannelId<P> | undefined =>
  INVENTORY_ID_FORMATS[platform].fromListed(listedId, workspaceId);

/** The id the saved inventory holds for the channel an event names. */
export const inventoryChannelIdOfEvent = <P extends PlatformName>(channel: {
  readonly platform: P;
  readonly channelId: SdkChannelId;
}): InventoryChannelId<P> =>
  INVENTORY_ID_FORMATS[channel.platform].ofEvent(channel.channelId);

/** A stored inventory row's `(platform, channel_id)`, or `undefined` if it is not one. */
export const parseInventoryChannelKey = (
  platform: string,
  value: string,
): InventoryChannelKey | undefined =>
  isPlatformName(platform)
    ? INVENTORY_ID_FORMATS[platform].parseKey(value)
    : undefined;

const nativeIdOfInventory = <P extends PlatformName>(
  channel: InventoryChannelOf<P>,
): NativeChannelId =>
  INVENTORY_ID_FORMATS[channel.platform].nativeOf(channel.channelId);

const addressOfInventory = <P extends PlatformName>(
  channel: InventoryChannelOf<P>,
): SdkChannelId | undefined =>
  INVENTORY_ID_FORMATS[channel.platform].addressOf(channel.channelId);

/** An inventory as GROWI is told it. */
export const toProtocolInventory = (
  channels: ReadonlyArray<InventoryChannel>,
): ChannelInventory => ({
  channels: channels.map((channel) => ({
    platform: channel.platform,
    channelId: nativeIdOfInventory(channel),
    channelName: channel.channelName,
    isPrivate: channel.isPrivate,
  })),
});

// ---------------------------------------------------------------------------
// A notification target GROWI names
// ---------------------------------------------------------------------------

export type NotificationTargetResolution =
  | { readonly kind: 'found'; readonly channel: SdkChannelRef }
  | { readonly kind: 'inventory-not-ready' }
  | { readonly kind: 'not-in-installation' }
  /** In the inventory, but held by an id that cannot be posted to (Teams). */
  | { readonly kind: 'unaddressable' };

/**
 * The channel a notification target names, looked up in the installation's
 * saved inventory (`null` when it has never been taken). The inventory is
 * the only list a target may come from, so a target outside it is refused here
 * rather than converted.
 */
export const resolveNotificationTarget = (
  inventory: ReadonlyArray<InventoryChannel> | null,
  target: {
    readonly platform: PlatformName;
    readonly channelId: NativeChannelId;
  },
): NotificationTargetResolution => {
  if (inventory == null) {
    return { kind: 'inventory-not-ready' };
  }
  // The service is compared as well as the id: two services may share a
  // channel id, and a row from the wrong one must not stand in for this one.
  const row = inventory.find(
    (channel) =>
      channel.platform === target.platform &&
      nativeIdOfInventory(channel) === target.channelId,
  );
  if (row == null) {
    return { kind: 'not-in-installation' };
  }
  const channelId = addressOfInventory(row);
  return channelId === undefined
    ? { kind: 'unaddressable' }
    : {
        kind: 'found',
        channel: {
          platform: row.platform,
          channelId,
          channelName: row.channelName,
          isPrivate: row.isPrivate,
        },
      };
};
