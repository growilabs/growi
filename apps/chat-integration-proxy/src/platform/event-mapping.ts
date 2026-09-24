// 「SDK のイベント → PlatformEvent（SDK 型はここで止まる）」 -- design.md's
// File Structure Plan for this file.
//
// Every function here is pure and synchronous: it reads what the Chat SDK
// already handed the handler and builds a value out of this app's own types.
// Nothing here registers a handler, performs I/O, or decides what to do with
// the result -- registering the handlers and passing the result to
// `PlatformEventSink.handle()` belongs to the layer's entry point (task 3.8).
//
// Two rules shape every function below:
//
//  1. **Copy, never carry.** A produced `PlatformEvent` holds only strings,
//     booleans and plain objects this file constructed. Spreading an SDK
//     object into the result would compile (TypeScript's excess-property check
//     only fires on fresh literals) and would smuggle a live `Thread` /
//     `adapter` back-reference past the boundary at runtime.
//  2. **Refuse rather than invent.** When the SDK's event does not carry
//     enough to build a valid `PlatformEvent`, the answer is `null`. In
//     particular an unaddressed, link-free message produces nothing: design.md
//     removed `reply` from `PlatformEvent` because `plainReply` is unverified
//     on all four services, so there is no kind such a message could become.
import type { PlatformName } from '@growi/chat';
import type {
  ActionEvent,
  Author,
  ChannelVisibility,
  Message,
  ModalSubmitEvent,
  SlashCommandEvent,
  Thread,
} from 'chat';

import type { InteractionRef, PlatformEvent } from '../types/index.js';
import { ADAPTER_FACTORIES } from './adapter-set.js';

/**
 * The Chat SDK types an adapter's `name` as a plain `string` -- it is the
 * adapter's own self-declared name, not the key `bot-factory.ts` registered it
 * under. `ADAPTER_FACTORIES` is this app's declared registry of the services it
 * serves (task 3.1), so it is also the honest answer to "is this one of ours?";
 * asking it avoids a second list of platform names drifting from the first.
 *
 * Verified against the installed adapters: `@chat-adapter/slack` declares
 * `"slack"`, `@chat-adapter/discord` `"discord"`, `@chat-adapter/teams`
 * `"teams"`, `chat-adapter-mattermost` `"mattermost"` -- all four equal to
 * `PlatformName`.
 */
const toPlatformName = (adapterName: string): PlatformName | null =>
  Object.hasOwn(ADAPTER_FACTORIES, adapterName)
    ? (adapterName as PlatformName)
    : null;

/**
 * `ChannelRef` needs the four values below; where they come from differs per
 * event (a `Thread` for a message, a `Channel` for a slash command), so the
 * source is destructured by the caller and only the construction lives here.
 *
 * `channelName` is display-only and is matched on by nothing (`ChannelRef`'s
 * own doc comment, Requirement 11.3), so an unfetched name (`Channel.name` is
 * `null` until metadata is fetched) becomes `''` rather than dropping the
 * event or making this function asynchronous. The channel's real display name
 * comes from the periodically refreshed inventory (`installation_channel` /
 * `ChannelDirectory`), not from the event.
 *
 * `isPrivate` treats `'external'` (Slack Connect) and `'unknown'` as not
 * private: it says "only invited members can see this", which is what a
 * disclosure decision needs to be able to rely on, and neither of those two
 * values asserts that.
 */
const toChannelRef = (
  platform: PlatformName,
  source: {
    readonly channelId: string;
    readonly channelName: string | null;
    readonly isDM: boolean;
    readonly channelVisibility: ChannelVisibility;
  },
) => ({
  platform,
  channelId: source.channelId,
  channelName: source.channelName ?? '',
  isPrivate: source.isDM || source.channelVisibility === 'private',
});

/**
 * `fullName` is what the platform shows; the handle is the fallback when it is
 * empty.
 *
 * Exported for `history.ts` (task 3.5), which names the author of every
 * imported message: one derivation means a person appears under the same name
 * whether they are quoted in a page or addressed the bot.
 */
export const toChatAccountRef = (platform: PlatformName, author: Author) => ({
  platform,
  accountId: author.userId,
  displayName: author.fullName === '' ? author.userName : author.fullName,
});

/**
 * The parts of the SDK's `Channel` / `Thread` these two helpers read.
 *
 * Declared structurally rather than as `Channel` / `Thread` because the SDK
 * types those with a per-entity state parameter that differs between the
 * events handed to us -- `ActionEvent.thread` is `Thread<TRawMessage>` (so its
 * *state* parameter lands on `unknown`), while `ModalSubmitEvent.relatedThread`
 * is `Thread<Record<string, unknown>, TRawMessage>`. The two are not mutually
 * assignable, and neither the state nor the raw-message type has anything to do
 * with building a `ChannelRef`.
 */
interface ChannelSource {
  readonly id: string;
  readonly name: string | null;
  readonly isDM: boolean;
  readonly channelVisibility: ChannelVisibility;
}

interface ThreadSource {
  readonly channelId: string;
  readonly isDM: boolean;
  readonly channelVisibility: ChannelVisibility;
  readonly channel: { readonly name: string | null };
}

const channelRefOfChannel = (platform: PlatformName, channel: ChannelSource) =>
  toChannelRef(platform, {
    channelId: channel.id,
    channelName: channel.name,
    isDM: channel.isDM,
    channelVisibility: channel.channelVisibility,
  });

const channelRefOfThread = (platform: PlatformName, thread: ThreadSource) =>
  toChannelRef(platform, {
    // The thread's own id is the thread, not the channel; `channelId` is the
    // conversation it lives in, which is what a `ChannelRef` names.
    channelId: thread.channelId,
    channelName: thread.channel.name,
    isDM: thread.isDM,
    channelVisibility: thread.channelVisibility,
  });

/**
 * A button carries two slots the platform gives back on a press (`actionId`
 * and `value`), but `PlatformEvent`'s `action` needs three values -- the
 * `correlationId` that `ArgumentCollector.resume` looks the in-flight
 * collection up by, the action's own name, and its payload. So the correlation
 * id travels inside the action id, and `value` stays the button's payload.
 *
 * **The encode and decode halves are one pair, exported together on purpose.**
 * Whatever renders a button (`platform/outbound.ts`, `platform/prompt.ts`) must
 * call `encodeActionId()` rather than assembling the same format by hand -- a
 * second spelling of it would be silently un-resumable.
 */
const ACTION_ID_PREFIX = 'growi-action';
const ACTION_ID_SEPARATOR = ':';

export const encodeActionId = (
  correlationId: string,
  actionId: string,
): string =>
  [ACTION_ID_PREFIX, correlationId, actionId].join(ACTION_ID_SEPARATOR);

/**
 * `null` for anything this proxy did not encode -- a leftover button from an
 * older deploy, or another app's action. Guessing a correlation id here would
 * resume some other conversation's collection.
 */
export const decodeActionId = (
  encoded: string,
): { readonly correlationId: string; readonly actionId: string } | null => {
  const parts = encoded.split(ACTION_ID_SEPARATOR);
  if (parts.length < 3 || parts[0] !== ACTION_ID_PREFIX) return null;

  const correlationId = parts[1] ?? '';
  // The action id may itself contain the separator, so everything after the
  // correlation id is put back together rather than taken as one segment.
  const actionId = parts.slice(2).join(ACTION_ID_SEPARATOR);
  if (correlationId === '' || actionId === '') return null;

  return { correlationId, actionId };
};

/**
 * A message the bot was handed: an addressed one becomes a `mention`, an
 * unaddressed one carrying URLs becomes `link-posted`, anything else becomes
 * nothing.
 *
 * The three branches live in one function so that the exclusion of unaddressed
 * replies is a property of this function rather than of whoever registers the
 * handlers.
 *
 * **Precedence matters.** An addressed message that also carries URLs stays a
 * `mention`: `link-posted` deliberately bypasses command parsing (design.md:
 * 「コマンドの解釈を通さない」), so demoting it would swallow the command.
 *
 * `link-posted` is not gated on the capability table, and must not be: only
 * the Slack adapter fills `Message.links` in (the other three never populate
 * it), so the data already reflects `linkPreview` being `full` for Slack and
 * `none` elsewhere. Consulting the table here would duplicate that declaration
 * and reintroduce the per-service branching design.md rules out.
 */
export const fromMessage = (
  thread: Thread,
  message: Message,
): PlatformEvent | null => {
  const platform = toPlatformName(thread.adapter.name);
  if (platform == null) return null;

  const channel = channelRefOfThread(platform, thread);
  const actor = toChatAccountRef(platform, message.author);

  // Strictly `true`: `Message.isMention` is `boolean | undefined`, and the SDK
  // leaves it unset when it has not judged the question. Treating "unknown" as
  // addressed would push an arbitrary message into command parsing, so the
  // unset case falls through to the two branches below.
  if (message.isMention === true) {
    return {
      kind: 'mention',
      platform,
      channel,
      actor,
      text: message.text,
      // A message notification never carries a modal handle (design.md:
      // 「mention の通知には付いてこない」).
      interaction: null,
    };
  }

  const urls = message.links.map((preview) => preview.url);
  if (urls.length === 0) return null;

  return {
    kind: 'link-posted',
    platform,
    channel,
    actor,
    messageRef: { channel, messageId: message.id },
    // Only the URL strings: a `LinkPreview` also carries a `fetchMessage`
    // callback that closes over the adapter.
    urls,
  };
};

/**
 * `interaction` is a **parameter, not something derived from the event**, and
 * that is the resolution of design.md's own warning that 「『有効な手がかりが
 * ある』を `interaction != null` と実装してはならない」.
 *
 * A modal is opened by handing the form back to this very event's own
 * `openModal()` closure -- see `prompt.ts` for why that is the only mechanism
 * that works on both services whose `modal` capability is `full`. So the handle
 * that names it is minted by whoever still holds the event (the handler
 * registration, task 3.8) and passed in here. Deriving it from `event.triggerId`
 * instead would produce `null` on Teams, whose events carry no trigger id at
 * all, and the caller would wrongly fall back to asking questions in the
 * channel on a service that renders modals perfectly well.
 *
 * `null` stays meaningful: it says this invocation has no way to open a modal,
 * which is 「手がかりが切れているなら、聞き返しの経路へ落とす」.
 */
export const fromSlashCommand = (
  event: SlashCommandEvent,
  interaction: InteractionRef | null,
): PlatformEvent | null => {
  const platform = toPlatformName(event.adapter.name);
  if (platform == null) return null;

  return {
    kind: 'slash-command',
    platform,
    channel: channelRefOfChannel(platform, event.channel),
    actor: toChatAccountRef(platform, event.user),
    command: event.command,
    text: event.text,
    interaction,
  };
};

/** `interaction` is passed in for the same reason as on `fromSlashCommand`. */
export const fromAction = (
  event: ActionEvent,
  interaction: InteractionRef | null,
): PlatformEvent | null => {
  const platform = toPlatformName(event.adapter.name);
  if (platform == null) return null;

  const decoded = decodeActionId(event.actionId);
  if (decoded == null) return null;

  // `null` for a view-based press (a home-tab button): there is no
  // conversation to answer in, so there is no `ChannelRef` to build.
  const thread = event.thread;
  if (thread == null) return null;

  return {
    kind: 'action',
    platform,
    channel: channelRefOfThread(platform, thread),
    actor: toChatAccountRef(platform, event.user),
    correlationId: decoded.correlationId,
    actionId: decoded.actionId,
    value: event.value ?? null,
    interaction,
  };
};

/**
 * A submitted modal. Its correlation id travels in the modal's
 * `privateMetadata` -- the SDK documents that field as the way to carry
 * arbitrary context through a modal's lifecycle, while `callbackId` is what
 * `onModalSubmit(callbackIds, handler)` filters handlers by and is therefore a
 * static name, not a per-invocation value.
 *
 * A submission with no correlation id, or with no conversation behind it, is
 * refused: both are needed to resume the collection it belongs to, and unlike a
 * slash command there is nothing to fall back to -- a submission that cannot be
 * placed has nowhere to be answered.
 */
export const fromModalSubmit = (
  event: ModalSubmitEvent,
): PlatformEvent | null => {
  const platform = toPlatformName(event.adapter.name);
  if (platform == null) return null;

  const correlationId = event.privateMetadata ?? '';
  if (correlationId === '') return null;

  const thread = event.relatedThread;
  const relatedChannel = event.relatedChannel;
  const channel =
    thread != null
      ? channelRefOfThread(platform, thread)
      : relatedChannel != null
        ? channelRefOfChannel(platform, relatedChannel)
        : null;
  if (channel == null) return null;

  return {
    kind: 'modal-submit',
    platform,
    channel,
    actor: toChatAccountRef(platform, event.user),
    correlationId,
    // Copied: `values` is the SDK's own payload object, and handing it over
    // would let a later mutation reach back into the event.
    values: { ...event.values },
  };
};
