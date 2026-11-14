// `CommandInvocation.normalize` -- design.md's Components and Interfaces
// table row for this file: 「mention / slash を 1 つの内部表現へ」(決定 4
// in the umbrella research.md: `@growi search foo` and `/growi search foo`
// must normalize to the same thing).
//
// Only the two `PlatformEvent` kinds that can start a command reach this
// function; `modal-submit` / `action` / `link-posted` are handled elsewhere
// (design.md's イベントの振り分け table) and are excluded from the parameter
// type itself rather than handled with a `null`/throw branch here, so a
// caller passing the wrong kind is a compile-time error, not a runtime one.
//
// This function only splits text -- it does not decide whether the result
// names a real command. An empty `commandName` (nothing followed the
// address, or a slash command registered with empty text) is a valid,
// non-throwing outcome: rejecting an unrecognized or empty `commandName` is
// `CommandSet`'s job (a later task), not this one's.
import type { PlatformEvent } from '../types/index.js';
import type { Invocation } from '../types/invocation.js';

/**
 * Splits `text` on the first run of whitespace into a head token and the
 * (trimmed) remainder: the command name and its arguments.
 */
const splitFirstToken = (
  text: string,
): { readonly head: string; readonly rest: string } => {
  const trimmed = text.trim();
  const match = /\s+/.exec(trimmed);
  if (match == null) return { head: trimmed, rest: '' };

  return {
    head: trimmed.slice(0, match.index),
    rest: trimmed.slice(match.index + match[0].length).trim(),
  };
};

/**
 * The event kinds that can start a command -- `PlatformEvent`'s other three
 * kinds (`modal-submit` / `action` / `link-posted`) are not commands and are
 * excluded from this type rather than handled at runtime (see file header).
 */
export type CommandStartEvent = Extract<
  PlatformEvent,
  { readonly kind: 'mention' | 'slash-command' }
>;

/** What a mention says about its place, leaving out the values absence already means. */
const placeOf = (
  event: Extract<CommandStartEvent, { readonly kind: 'mention' }>,
): Pick<
  Invocation,
  'threadRootId' | 'replyThreadRootId' | 'isDirectMessage'
> => ({
  ...(event.threadRootId == null ? {} : { threadRootId: event.threadRootId }),
  ...(event.replyThreadRootId == null
    ? {}
    : { replyThreadRootId: event.replyThreadRootId }),
  ...(event.inDirectMessage ? { isDirectMessage: true } : {}),
});

export const CommandInvocation = {
  /**
   * A `mention` is read off `textWithoutBotAddress`, which the platform layer
   * built from the bot's own identity (research.md's Decision on removing
   * the bot address there); `text` is never re-parsed here.
   *
   * `slash-command`'s `command` / `text` are already split by the platform's
   * own UI (design.md: 「コマンド名が確定しているため」), so they map
   * directly with no parsing -- only a trim, to match what the mention path
   * produces for the same content.
   */
  normalize(event: CommandStartEvent): Invocation {
    const { commandName, argsText } =
      event.kind === 'mention'
        ? (() => {
            const { head, rest } = splitFirstToken(event.textWithoutBotAddress);
            return { commandName: head, argsText: rest };
          })()
        : { commandName: event.command.trim(), argsText: event.text.trim() };

    return {
      platform: event.platform,
      channel: event.channel,
      actor: event.actor,
      commandName,
      argsText,
      interaction: event.interaction,
      sourceMessageId: event.kind === 'mention' ? event.messageId : null,
      ...(event.installation == null
        ? {}
        : { installation: event.installation }),
      ...(event.kind === 'mention' ? placeOf(event) : {}),
    };
  },
};
