// A chat service that pushes events into the proxy and keeps everything the
// proxy sends back (tasks.md 11.1's 「偽のチャットサービス -- 4 サービス分の
// イベントを流し込み、投稿を受け取れるもの」).
//
// TEST INFRASTRUCTURE, NOT PRODUCTION SURFACE -- see `signing-identity.ts`.
//
// **It stands in for `createPlatformFacade`, not for a chat service's wire
// protocol.** `startProxy` takes `createFacade` as an override precisely so a
// test can drive the whole app without four live connections (Implementation
// Note 9.1); this file is that override. What it does NOT exercise is
// `platform/event-mapping.ts` -- see `chat-events.ts` for why that boundary is
// where it is.
//
// **The distributed lock is deliberately absent here.** `locks()` answers a
// lock that never contends, which is right for 11.2/11.3 and wrong for 11.4:
// the ownership rules 11.4 checks live in PostgreSQL, so that task must start
// its instances with the REAL facade and leave this one out of the way. The
// cluster passes overrides through per instance so both are possible.

import type { ChatAccountRef, PlatformName } from '@growi/chat';

import type {
  ConnectionManager,
  ConnectionStatusRow,
  InstallationProvider,
  PlatformFacade,
} from '../platform/index.js';
import type {
  AdminActorRoles,
  ChannelListing,
  DirectPostOutcome,
  DistributedLock,
  EphemeralPostOutcome,
  HistoryOutcome,
  InteractionRef,
  ModalForm,
  OutboundMessage,
  PlatformAppConfig,
  PlatformEvent,
  PlatformEventSink,
  PostOutcome,
  ReactionName,
  ReactionOutcome,
  SdkChannelRef,
  SdkMessageRef,
  TimeRange,
} from '../types/index.js';
import { sdkChannelIdOn } from './chat-events.js';

/** How the proxy tried to reach a chat user. */
export type CapturedPostKind =
  | 'post'
  | 'ephemeral'
  | 'direct'
  | 'replace'
  | 'preview';

export interface CapturedPost {
  readonly kind: CapturedPostKind;
  /** On a direct message, the 1:1 conversation it was posted into. */
  readonly channel: SdkChannelRef;
  /** Set only on an ephemeral or direct message: who alone was meant to see it. */
  readonly user?: ChatAccountRef;
  /** Set on a replacement or a preview: which message it attached to. */
  readonly messageId?: string;
  readonly message: OutboundMessage;
}

export interface CapturedReaction {
  readonly target: SdkMessageRef;
  readonly reaction: ReactionName;
}

/** Whether the proxy handled a delivered event, and what went wrong if not. */
export type DeliveryOutcome =
  | { readonly handled: true }
  | { readonly handled: false; readonly error: unknown };

export interface CapturedModal {
  readonly trigger: InteractionRef;
  readonly form: ModalForm;
  readonly correlationId: string;
}

/**
 * What this fake answers with. Every field is optional: a test scripts only
 * the outcome its case turns on, and the rest succeed.
 */
export interface FakeChatScript {
  readonly post?: (post: CapturedPost) => PostOutcome;
  /**
   * Unscripted (or answering `undefined`), an ephemeral message is answered
   * like a post. An `unsupported` answer is not recorded in `posts()`: the
   * real facade returns it before anything is sent.
   */
  readonly postEphemeral?: (
    post: CapturedPost,
  ) => EphemeralPostOutcome | undefined;
  readonly postDirect?: (post: CapturedPost) => DirectPostOutcome;
  readonly addReaction?: (reaction: CapturedReaction) => ReactionOutcome;
  readonly openModal?: (modal: CapturedModal) => boolean;
  readonly listChannels?: (installationId: string) => ChannelListing;
  readonly fetchHistory?: (
    channel: SdkChannelRef,
    range: TimeRange,
  ) => HistoryOutcome;
  readonly webhook?: (
    platform: PlatformName,
    request: Request,
  ) => Promise<Response>;
  /**
   * The roles the actor holds, as the chat service would report them
   * (`ADMIN_CHECK_TABLE`'s vocabulary: `is_admin`, `ADMINISTRATOR`, ...).
   *
   * Unscripted, this fake answers `null` -- 「役割を読み取れなかった」, which
   * refuses every operator command. That is the fail-closed default on
   * purpose: a test that means to act as a workspace administrator has to say
   * so, rather than becoming one because nothing said otherwise.
   */
  readonly observeActorRoles?: (
    installationId: string,
    channel: SdkChannelRef,
    actor: ChatAccountRef,
  ) => AdminActorRoles | null;
}

export interface FakeChatService {
  /**
   * The `createFacade` override to hand `startProxy`. Attaching the sink is
   * what makes `emit` usable, so a test that never starts a proxy cannot
   * accidentally push events into nothing.
   */
  readonly createFacade: (
    appConfig: PlatformAppConfig,
    installations: InstallationProvider,
    sink: PlatformEventSink,
  ) => Promise<PlatformFacade>;
  /**
   * Delivers one event to the proxy, exactly as a live connection would.
   * Rejects with whatever the proxy's own sink threw.
   */
  readonly emit: (event: PlatformEvent) => Promise<void>;
  /**
   * The same delivery, with the outcome as a value rather than as an
   * exception.
   *
   * A chat connection never sees the proxy's exceptions -- the SDK swallows a
   * handler that throws -- so a test that only had `emit` would report a flow
   * that threw and a flow that answered nothing in the same way: as a failing
   * assertion about `posts()`. This tells the two apart.
   */
  readonly deliver: (event: PlatformEvent) => Promise<DeliveryOutcome>;
  /**
   * Channel posts, ephemeral messages and direct messages, in order sent --
   * including ones answered with a failure, except an `unsupported` ephemeral.
   */
  readonly posts: () => ReadonlyArray<CapturedPost>;
  readonly reactions: () => ReadonlyArray<CapturedReaction>;
  readonly modals: () => ReadonlyArray<CapturedModal>;
  /** Everything `webhookHandler` was asked to serve, by service. */
  readonly webhookCalls: () => ReadonlyArray<PlatformName>;
  readonly shutdownCount: () => number;
}

const posted = (messageId: string): PostOutcome => ({ ok: true, messageId });

/** The 1:1 conversation with `user`: one per person, never the channel asked from. */
const directChannelOf = (user: ChatAccountRef): SdkChannelRef => ({
  platform: user.platform,
  channelId: sdkChannelIdOn(user.platform, `dm-${user.accountId}`),
  channelName: '',
  isPrivate: true,
});

/** A lock nobody else holds. See this file's header for why that is deliberate. */
const uncontendedLock = (): DistributedLock => {
  const held = new Set<string>();
  return {
    acquire: (key) => {
      if (held.has(key)) return Promise.resolve(false);
      held.add(key);
      return Promise.resolve(true);
    },
    renew: (key) => Promise.resolve(held.has(key)),
    release: (key) => {
      held.delete(key);
      return Promise.resolve();
    },
  };
};

/** A connection manager with nothing to reconcile: see this file's header. */
const idleConnections = (): ConnectionManager => ({
  start: () => Promise.resolve(),
  stopAll: () => Promise.resolve(),
  reconcile: () => Promise.resolve(),
  status: (): Promise<ReadonlyArray<ConnectionStatusRow>> =>
    Promise.resolve([]),
});

export const createFakeChatService = (
  script: FakeChatScript = {},
): FakeChatService => {
  const posts: CapturedPost[] = [];
  const reactions: CapturedReaction[] = [];
  const modals: CapturedModal[] = [];
  const webhookCalls: PlatformName[] = [];
  let sink: PlatformEventSink | null = null;
  let shutdowns = 0;
  let nextMessageId = 0;
  const lock = uncontendedLock();
  const connections = idleConnections();

  /** The one delivery path both `emit` and `deliver` go through. */
  const handle = async (event: PlatformEvent): Promise<void> => {
    if (sink == null) {
      throw new Error(
        `no proxy is attached to this fake chat service yet (tried to deliver a ${event.kind} on ${event.platform})`,
      );
    }
    await sink.handle(event);
  };

  const capture = (post: CapturedPost): PostOutcome => {
    posts.push(post);
    nextMessageId += 1;
    return script.post?.(post) ?? posted(`message-${nextMessageId}`);
  };

  const facade: PlatformFacade = {
    post: async (channel, message) =>
      capture({ kind: 'post', channel, message }),

    postEphemeral: (channel, user, message) => {
      const ephemeral: CapturedPost = {
        kind: 'ephemeral',
        channel,
        user,
        message,
      };
      const scripted = script.postEphemeral?.(ephemeral);
      if (scripted == null) return Promise.resolve(capture(ephemeral));
      if (!scripted.ok && scripted.reason === 'unsupported') {
        return Promise.resolve(scripted);
      }
      posts.push(ephemeral);
      nextMessageId += 1;
      return Promise.resolve(scripted);
    },

    postDirect: (_near, user, message) => {
      const direct: CapturedPost = {
        kind: 'direct',
        channel: directChannelOf(user),
        user,
        message,
      };
      posts.push(direct);
      nextMessageId += 1;
      return Promise.resolve(
        script.postDirect?.(direct) ?? {
          ok: true,
          messageId: `message-${nextMessageId}`,
          channel: direct.channel,
        },
      );
    },

    addReaction: (target, reaction) => {
      const captured: CapturedReaction = { target, reaction };
      reactions.push(captured);
      return Promise.resolve(script.addReaction?.(captured) ?? { ok: true });
    },

    replace: async (message: SdkMessageRef, replacement) =>
      capture({
        kind: 'replace',
        channel: message.channel,
        messageId: message.messageId,
        message: replacement,
      }),

    attachPreview: async (target: SdkMessageRef, preview) =>
      capture({
        kind: 'preview',
        channel: target.channel,
        messageId: target.messageId,
        message: preview,
      }),

    openModal: (trigger, form, correlationId) => {
      const modal: CapturedModal = { trigger, form, correlationId };
      modals.push(modal);
      return Promise.resolve(script.openModal?.(modal) ?? true);
    },

    observeActorRoles: async (installationId, channel, actor) =>
      script.observeActorRoles?.(installationId, channel, actor) ?? null,

    listChannels: async (installationId) =>
      script.listChannels?.(installationId) ?? { channels: [] },

    fetchHistory: async (channel, range) =>
      script.fetchHistory?.(channel, range) ?? { ok: true, messages: [] },

    webhookHandler: (platform) => async (request) => {
      webhookCalls.push(platform);
      return (
        (await script.webhook?.(platform, request)) ??
        new Response(null, { status: 200 })
      );
    },

    connections: () => connections,
    locks: () => lock,
    shutdown: () => {
      shutdowns += 1;
      return Promise.resolve();
    },
  };

  return {
    createFacade: (_appConfig, _installations, attached) => {
      sink = attached;
      return Promise.resolve(facade);
    },

    emit: (event) => handle(event),

    deliver: async (event) => {
      try {
        await handle(event);
        return { handled: true };
      } catch (error) {
        return { handled: false, error };
      }
    },

    posts: () => [...posts],
    reactions: () => [...reactions],
    modals: () => [...modals],
    webhookCalls: () => [...webhookCalls],
    shutdownCount: () => shutdowns,
  };
};
