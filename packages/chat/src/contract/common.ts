// Cross-layer base types shared by every contract in this package
// (command/notification/account-link/pairing/settings). Both
// `chat-integration-proxy` and `chat-integration-app` import these from
// `@growi/chat`'s client-safe entry point.

export type PlatformName = 'slack' | 'discord' | 'teams' | 'mattermost';

/**
 * A user as identified on the chat platform. NOT a GROWI user (Requirement
 * 7.8): the proxy holds no chat-account <-> GROWI-user mapping table, so
 * this type must never be extended with a GROWI user reference. Resolving
 * this to a GROWI user, if one is linked, is the app layer's job.
 */
export interface ChatAccountRef {
  readonly platform: PlatformName;
  readonly accountId: string;
  /** Used to display an unlinked speaker's identity (Requirement 5.3). */
  readonly displayName: string;
}

export interface ChannelRef {
  readonly platform: PlatformName;
  /**
   * The only field used to match a channel. `channelName` is
   * display-only and may be renamed on the chat platform, so it must never
   * be used for matching/authorization decisions (Requirement 11.3).
   */
  readonly channelId: string;
  readonly channelName: string;
  readonly isPrivate: boolean;
}

export interface MessageRef {
  readonly channel: ChannelRef;
  readonly messageId: string;
}
