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
 * (trimmed) remainder. Used twice below: once to drop the mention's own
 * address token, once to pull the command name off what is left.
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

/**
 * Drops a mention's leading address token (`@growi`) and returns the rest
 * VERBATIM -- inner whitespace, newlines included, untouched.
 *
 * Exported because `argument-collector.ts` needs the same address-stripping
 * for a follow-up ANSWER, which is not a command and must not be re-split
 * into a command name and a remainder: an answer to a `multiline` field can
 * legitimately start with a short first line, and splitting then rejoining it
 * would collapse the newline after that line.
 */
export const stripAddressToken = (text: string): string =>
  splitFirstToken(text).rest;

export const CommandInvocation = {
  /**
   * `mention`'s `text` still carries the address token the bot was mentioned
   * with (`event-mapping.ts`'s `fromMessage` copies `message.text` through
   * unchanged, e.g. `"@growi search foo"` -- confirmed against its
   * `event-mapping.spec.ts` fixtures, which assert the address token is
   * still present on the produced `PlatformEvent`). This function is
   * therefore the one place that strips it: the first whitespace-delimited
   * token is always the address, never part of the command, so it is
   * dropped unconditionally before the command name is read off the rest.
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
            const { rest: afterAddress } = splitFirstToken(event.text);
            const { head, rest } = splitFirstToken(afterAddress);
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
    };
  },
};
