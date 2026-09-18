// `PlatformEvent` / `PlatformAppConfig` / `InstallationCredentials` are three
// more of the `PlatformFacade`'s seven boundary types (see
// outbound-message.ts for the same invariant): "platform 層の出入口に Chat
// SDK の型を含めない". `event-mapping.ts` (a later task, `platform/`) is
// where a Chat SDK event gets turned into a `PlatformEvent` -- "SDK 型は
// ここで止まる" (design.md's File Structure Plan) -- so nothing past that
// point, including this file, may import the SDK.
import type {
  ChannelRef,
  ChatAccountRef,
  MessageRef,
  PlatformName,
} from '@growi/chat';

import type { InteractionRef } from './index.js';

/**
 * Exactly design.md's declared union. Note `reply` is deliberately absent:
 * "いまは呼びかけ無しの返信を受け付けない...`PlatformEvent` の型からも外す"
 * (design.md, プラットフォーム能力表 section) -- a chat-integration-proxy
 * PlatformEvent handler can only ever see these five kinds.
 */
export type PlatformEvent =
  | {
      readonly kind: 'mention';
      readonly platform: PlatformName;
      readonly channel: ChannelRef;
      readonly actor: ChatAccountRef;
      readonly text: string;
      readonly interaction: InteractionRef | null;
    }
  | {
      readonly kind: 'slash-command';
      readonly platform: PlatformName;
      readonly channel: ChannelRef;
      readonly actor: ChatAccountRef;
      readonly command: string;
      readonly text: string;
      /**
       * `null` when the platform handed this invocation no short-lived
       * modal handle. Only Slack supplies one (`trigger_id`); Discord
       * supports slash commands and never does. Dropping the event there
       * would make the command unusable, so the missing handle is reported
       * rather than treated as an invalid event -- design.md's 「手がかりが
       * 切れているなら、聞き返しの経路へ落とす」 is exactly this case.
       */
      readonly interaction: InteractionRef | null;
    }
  | {
      readonly kind: 'modal-submit';
      readonly platform: PlatformName;
      readonly channel: ChannelRef;
      readonly actor: ChatAccountRef;
      readonly correlationId: string;
      readonly values: Readonly<Record<string, string>>;
    }
  | {
      readonly kind: 'action';
      readonly platform: PlatformName;
      readonly channel: ChannelRef;
      readonly actor: ChatAccountRef;
      readonly correlationId: string;
      readonly actionId: string;
      readonly value: string | null;
      /** `null` for the same reason as on `slash-command` above. */
      readonly interaction: InteractionRef | null;
    }
  | {
      readonly kind: 'link-posted';
      readonly platform: PlatformName;
      readonly channel: ChannelRef;
      readonly actor: ChatAccountRef;
      readonly messageRef: MessageRef;
      readonly urls: ReadonlyArray<string>;
    };

/**
 * What `platform/` hands a converted `PlatformEvent` to (design.md declares it
 * alongside `PlatformEvent` itself). Declared here rather than in
 * `orchestration/` because `platform/` -- which calls it -- sits to the LEFT of
 * `orchestration/` in the declared dependency order and so cannot import from
 * it; `orchestration/event-sink.ts` implements this type.
 */
export interface PlatformEventSink {
  handle(event: PlatformEvent): Promise<void>;
}

/**
 * Values that exist once per app, used to open the always-on connection
 * (design.md, PlatformFacade section: "アプリごとに 1 つしかない値。常時接続
 * を開くのに使う値はすべてこちら"). `runtime/config.ts` (a later task) is
 * the only file allowed to read `process.env` and build this.
 */
export interface PlatformAppConfig {
  readonly slack?: {
    readonly signingSecret: string;
    readonly clientId: string;
    readonly clientSecret: string;
    /** `xapp-`-prefixed app-level token; opens the Socket Mode connection. */
    readonly appToken: string;
  };
  readonly discord?: {
    readonly applicationId: string;
    readonly publicKey: string;
    /** Used to exchange an OAuth callback `code` for a token. */
    readonly clientSecret: string;
    /**
     * Opens the Gateway connection. Discord has one bot token per app, not
     * one per joined server.
     */
    readonly botToken: string;
  };
  readonly teams?: { readonly clientId: string; readonly clientSecret: string };
  readonly stateConnectionString: string;
}

/**
 * Values that only make sense for one workspace -- used for per-workspace
 * calls like posting or listing channels (design.md, PlatformFacade
 * section: "その workspace でしか通用しない値"). Resolved via
 * `InstallationProvider.resolve()`. Deliberately excludes anything needed to
 * open the always-on connection -- see `PlatformAppConfig` above.
 */
export interface InstallationCredentials {
  /**
   * Slack connects once per app but posts per workspace (Socket Mode
   * resolves the workspace by `team_id`).
   */
  readonly slack?: { readonly botToken: string };
  /** Discord posts with the same app-wide bot token, so nothing is workspace-specific. */
  readonly discord?: Record<string, never>;
  readonly teams?: { readonly tenantId: string };
  /** Mattermost's connection target itself differs per installation. */
  readonly mattermost?: { readonly baseUrl: string; readonly botToken: string };
}
