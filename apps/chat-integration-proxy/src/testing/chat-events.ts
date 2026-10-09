// Builders for the events the four chat services deliver (tasks.md 11.1's
// 「4 サービス分のイベントを流し込み」).
//
// TEST INFRASTRUCTURE, NOT PRODUCTION SURFACE -- see `signing-identity.ts`.
//
// **These build `PlatformEvent`s, not the services' own wire payloads.** The
// step from a Chat SDK event to a `PlatformEvent` belongs to
// `platform/event-mapping.ts`, whose own spec already covers all four services;
// and `architecture.spec.ts` forbids naming the Chat SDK anywhere outside
// `platform/`, so a harness that built raw Slack or Discord payloads could not
// live here at all. What 11.2-11.5 get from these builders is therefore each
// service's COMMAND FLOW, not its wire format.
//
// What still differs per service is carried as data below (`SERVICE_FIXTURES`),
// not as a branch in the builders: adding a fifth service is one entry, and no
// caller changes.

import type { ChannelRef, ChatAccountRef, PlatformName } from '@growi/chat';

import type { InteractionRef, PlatformEvent } from '../types/index.js';

interface ServiceFixture {
  readonly channelId: string;
  readonly channelName: string;
  readonly accountId: string;
  readonly displayName: string;
  /**
   * Whether this service hands an invocation a short-lived modal handle.
   * design.md's 「手がかりが切れているなら、聞き返しの経路へ落とす」 only
   * happens for services where this is `false`, so a harness that gave every
   * service a handle could never reach the non-modal path at all.
   */
  readonly interactive: boolean;
}

/** One entry per `PlatformName`; a missing service will not compile. */
const SERVICE_FIXTURES: Readonly<Record<PlatformName, ServiceFixture>> = {
  slack: {
    channelId: 'C0SLACK001',
    channelName: 'general',
    accountId: 'U0SLACK001',
    displayName: 'Ada',
    interactive: true,
  },
  discord: {
    channelId: '900000000000000001',
    channelName: 'general',
    accountId: '800000000000000001',
    displayName: 'Grace',
    interactive: false,
  },
  teams: {
    channelId: '19:teams-channel-1@thread.tacv2',
    channelName: 'General',
    accountId: '29:teams-user-1',
    displayName: 'Alan',
    interactive: true,
  },
  mattermost: {
    channelId: 'mmchannel00000000000000001',
    channelName: 'town-square',
    accountId: 'mmuser000000000000000000001',
    displayName: 'Barbara',
    interactive: false,
  },
};

export const channelOn = (
  platform: PlatformName,
  overrides: Partial<Omit<ChannelRef, 'platform'>> = {},
): ChannelRef => {
  const fixture = SERVICE_FIXTURES[platform];
  return {
    platform,
    channelId: fixture.channelId,
    channelName: fixture.channelName,
    isPrivate: false,
    ...overrides,
  };
};

export const actorOn = (
  platform: PlatformName,
  overrides: Partial<Omit<ChatAccountRef, 'platform'>> = {},
): ChatAccountRef => {
  const fixture = SERVICE_FIXTURES[platform];
  return {
    platform,
    accountId: fixture.accountId,
    displayName: fixture.displayName,
    ...overrides,
  };
};

/** `null` on the services that hand an invocation no modal handle. */
export const interactionOn = (platform: PlatformName): InteractionRef | null =>
  SERVICE_FIXTURES[platform].interactive
    ? { token: `${platform}-interaction-1` }
    : null;

interface EventOverrides {
  readonly channel?: ChannelRef;
  readonly actor?: ChatAccountRef;
  readonly interaction?: InteractionRef | null;
}

export const mentionOn = (
  platform: PlatformName,
  options: EventOverrides & { readonly text: string },
): PlatformEvent => ({
  kind: 'mention',
  platform,
  channel: options.channel ?? channelOn(platform),
  actor: options.actor ?? actorOn(platform),
  text: options.text,
  interaction:
    options.interaction === undefined
      ? interactionOn(platform)
      : options.interaction,
});

export const actionOn = (
  platform: PlatformName,
  options: EventOverrides & {
    readonly correlationId: string;
    readonly actionId: string;
    readonly value?: string | null;
  },
): PlatformEvent => ({
  kind: 'action',
  platform,
  channel: options.channel ?? channelOn(platform),
  actor: options.actor ?? actorOn(platform),
  correlationId: options.correlationId,
  actionId: options.actionId,
  value: options.value ?? null,
  interaction:
    options.interaction === undefined
      ? interactionOn(platform)
      : options.interaction,
});

export const modalSubmitOn = (
  platform: PlatformName,
  options: EventOverrides & {
    readonly correlationId: string;
    readonly values: Readonly<Record<string, string>>;
  },
): PlatformEvent => ({
  kind: 'modal-submit',
  platform,
  channel: options.channel ?? channelOn(platform),
  actor: options.actor ?? actorOn(platform),
  correlationId: options.correlationId,
  values: options.values,
});

export const linkPostedOn = (
  platform: PlatformName,
  options: EventOverrides & {
    readonly messageId: string;
    readonly urls: ReadonlyArray<string>;
  },
): PlatformEvent => {
  const channel = options.channel ?? channelOn(platform);
  return {
    kind: 'link-posted',
    platform,
    channel,
    actor: options.actor ?? actorOn(platform),
    messageRef: { channel, messageId: options.messageId },
    urls: options.urls,
  };
};
