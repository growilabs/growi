// The one place that decides how a reply meant for one person reaches them
// (design.md's `PrivateReplier` and 「本人宛ての返事の届け方」): an ephemeral
// message in place, else a DM, else a content-free notice. Callers outside
// `platform/` are meant to reach `postEphemeral` / `postDirect` only through
// this file, so the "never post the reply publicly" invariant has one owner.
import type { ChatAccountRef, PlatformName } from '@growi/chat';

import type { PlatformFacade } from '../platform/index.js';
import type {
  EphemeralPostOutcome,
  OutboundMessage,
  ReactionName,
  SdkChannelRef,
} from '../types/index.js';

/** Who asked, where, and for what -- enough to address and label a reply. */
export interface PrivateReplyOrigin {
  readonly channel: SdkChannelRef;
  readonly actor: ChatAccountRef;
  /** The message that carried the request; `null` when there is none (modal, slash command). */
  readonly sourceMessageId: string | null;
  /** What was asked, as the DM header shows it, e.g. `search foo`. Never the reply itself. */
  readonly requestSummary: string;
  /**
   * The installation the proxy speaks as. `null` when the caller does not know it yet
   * (e.g. "this workspace is not registered"); the replier then resolves it from `channel`.
   */
  readonly installationId: string | null;
}

export type PrivateReplyOutcome =
  | { readonly kind: 'in-place' }
  | { readonly kind: 'direct'; readonly directChannel: SdkChannelRef }
  | { readonly kind: 'undeliverable' };

export interface PrivateReplier {
  reply(
    origin: PrivateReplyOrigin,
    message: OutboundMessage,
  ): Promise<PrivateReplyOutcome>;
  /**
   * Tells the requester the request was received, without content: a reaction on the
   * request message, or -- when there is none or it fails -- `fallback` sent through `reply`.
   */
  acknowledge(
    origin: PrivateReplyOrigin,
    fallback: OutboundMessage,
  ): Promise<void>;
}

/** What the operator sees. Carries no reply content (Requirement 1.7). */
export interface UndeliverableFact {
  readonly platform: PlatformName;
  readonly channelId: string;
  readonly ephemeralFailure: string;
  readonly directFailure: string;
}

export interface PrivateReplierDeps {
  readonly platform: Pick<
    PlatformFacade,
    'post' | 'postEphemeral' | 'postDirect' | 'addReaction'
  >;
  readonly describePlace: (channel: SdkChannelRef) => Promise<string | null>;
  readonly resolveInstallationId: (
    channel: SdkChannelRef,
  ) => Promise<string | null>;
  readonly reportUndeliverable: (fact: UndeliverableFact) => void;
}

type Scope = { readonly installationId: string } | undefined;

const UNKNOWN_PLACE = '元のチャンネル';

const headerOf = (place: string, requestSummary: string): string =>
  `${place} での「${requestSummary}」への返事です`;

const directNoticeOf = (actor: ChatAccountRef): OutboundMessage => ({
  kind: 'markdown',
  markdown: `${actor.displayName} さん、返事を DM で送りました。`,
});

const undeliverableNoticeOf = (actor: ChatAccountRef): OutboundMessage => ({
  kind: 'markdown',
  markdown: `${actor.displayName} さんへの返事を届けられませんでした。DM を送れませんでした。bot からの DM を受け取れる設定かを確かめ、それでも届かなければ運用者に連絡してください。`,
});

/**
 * Puts the header in front of the reply and changes nothing else
 * (Requirement 2.2). A list's title is the only slot ahead of its rows, and
 * it is rendered bold on one line, so the header joins it without a newline.
 */
const withHeader = (
  header: string,
  message: OutboundMessage,
): OutboundMessage => {
  switch (message.kind) {
    case 'markdown':
      return { ...message, markdown: `${header}\n\n${message.markdown}` };
    case 'list':
      return { ...message, title: `${header} — ${message.title}` };
    case 'choice':
      return { ...message, prompt: `${header}\n\n${message.prompt}` };
  }
};

// The reason, never the remedy: the remedy is advice for a user and may not
// match the actual cause (tasks.md Implementation Notes, 2.4).
const ephemeralFailureOf = (
  outcome: Extract<EphemeralPostOutcome, { ok: false }>,
): string =>
  outcome.reason === 'platform-error'
    ? `platform-error: ${outcome.detail}`
    : outcome.reason;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Runs `operation`, turning a rejection into `fallback(error)`: this component never throws. */
const settle = async <T>(
  operation: () => Promise<T>,
  fallback: (error: unknown) => T,
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    return fallback(error);
  }
};

export const createPrivateReplier = (
  deps: PrivateReplierDeps,
): PrivateReplier => {
  const { platform } = deps;

  const scopeOf = async (origin: PrivateReplyOrigin): Promise<Scope> => {
    const installationId =
      origin.installationId ??
      (await settle(
        () => deps.resolveInstallationId(origin.channel),
        () => null,
      ));
    return installationId == null ? undefined : { installationId };
  };

  const react = async (
    origin: PrivateReplyOrigin,
    reaction: ReactionName,
    scope: Scope,
  ): Promise<boolean> => {
    const { sourceMessageId } = origin;
    if (sourceMessageId == null) return false;
    const outcome = await settle(
      () =>
        platform.addReaction(
          { channel: origin.channel, messageId: sourceMessageId },
          reaction,
          scope,
        ),
      (error) => ({ ok: false, detail: messageOf(error) }) as const,
    );
    return outcome.ok;
  };

  /** Posts a content-free notice in place; its failure leaves nothing to do. */
  const postNotice = async (
    origin: PrivateReplyOrigin,
    notice: OutboundMessage,
    scope: Scope,
  ): Promise<void> => {
    await settle(
      () => platform.post(origin.channel, notice, scope),
      () => undefined,
    );
  };

  const report = (fact: UndeliverableFact): void => {
    try {
      deps.reportUndeliverable(fact);
    } catch {
      // Reporting is best effort; the caller still gets `undeliverable`.
    }
  };

  const deliver = async (
    origin: PrivateReplyOrigin,
    message: OutboundMessage,
    scope: Scope,
  ): Promise<PrivateReplyOutcome> => {
    const ephemeral = await settle<EphemeralPostOutcome>(
      () =>
        platform.postEphemeral(origin.channel, origin.actor, message, scope),
      (error) => ({
        ok: false,
        reason: 'platform-error',
        detail: messageOf(error),
      }),
    );
    if (ephemeral.ok) return { kind: 'in-place' };

    const place = await settle(
      () => deps.describePlace(origin.channel),
      () => null,
    );
    const header = headerOf(place ?? UNKNOWN_PLACE, origin.requestSummary);
    const direct = await settle(
      () =>
        platform.postDirect(
          origin.channel,
          origin.actor,
          withHeader(header, message),
          scope,
        ),
      (error) => ({ ok: false, detail: messageOf(error) }) as const,
    );

    if (direct.ok) {
      // A repeat reply of the same request finds the reaction already there,
      // which `addReaction` answers as success -- so no second notice.
      if (!(await react(origin, 'email', scope))) {
        await postNotice(origin, directNoticeOf(origin.actor), scope);
      }
      return { kind: 'direct', directChannel: direct.channel };
    }

    await postNotice(origin, undeliverableNoticeOf(origin.actor), scope);
    report({
      platform: origin.channel.platform,
      channelId: origin.channel.channelId,
      ephemeralFailure: ephemeralFailureOf(ephemeral),
      directFailure: direct.detail,
    });
    return { kind: 'undeliverable' };
  };

  return {
    async reply(origin, message) {
      return deliver(origin, message, await scopeOf(origin));
    },
    async acknowledge(origin, fallback) {
      const scope = await scopeOf(origin);
      if (await react(origin, 'eyes', scope)) return;
      await deliver(origin, fallback, scope);
    },
  };
};
