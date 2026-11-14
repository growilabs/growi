// Taking the bot's own address out of a message's text (Requirement 15.17,
// research.md's Decision on the platform layer removing it). Each service
// puts a different form of the bot into `Message.text`, and only the adapter
// knows the bot, so the forms are declared per service below; mentions of
// anyone else are left exactly as typed.
import type { PlatformName } from '@growi/chat';
import type { Adapter, Message } from 'chat';

/** The forms the bot's own address takes in `message.text`. */
export type BotAddressReading = (
  adapter: Adapter,
  message: Message,
) => readonly string[];

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  value != null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};

const TEAMS_MENTION_TEXT = /^<at>(.+)<\/at>$/;

/**
 * Teams writes a mention as `@<the name in its <at> tag>`, and that name is the
 * app's display name in Teams, which the adapter is never told. The activity's
 * mention entities say which `<at>` tag names the bot: the one whose
 * `mentioned.id` is the activity's recipient.
 */
const teamsBotAddresses: BotAddressReading = (_adapter, message) => {
  const activity = asRecord(message.raw);
  const botId = asRecord(activity.recipient).id;
  const entities = Array.isArray(activity.entities) ? activity.entities : [];
  if (!nonEmpty(botId)) return [];
  return entities.flatMap((entity: unknown) => {
    const { type, text, mentioned } = asRecord(entity);
    if (type !== 'mention' || asRecord(mentioned).id !== botId) return [];
    const name = typeof text === 'string' && TEAMS_MENTION_TEXT.exec(text)?.[1];
    return nonEmpty(name) ? [`@${name}`] : [];
  });
};

/** One entry per `PlatformName`; a missing service will not compile. */
export const BOT_ADDRESS_READINGS: Readonly<
  Record<PlatformName, BotAddressReading>
> = {
  // The adapter leaves its own `<@U…>` as `@U…`, and renders everyone else
  // by display name.
  slack: (adapter) => {
    const id = adapter.botUserId;
    return nonEmpty(id) ? [`@${id}`] : [];
  },
  // `botUserId` is the application id; the text keeps Discord's own markup.
  discord: (adapter) => {
    const id = adapter.botUserId;
    return nonEmpty(id) ? [`<@${id}>`, `<@!${id}>`] : [];
  },
  teams: teamsBotAddresses,
  // The adapter never rewrites a post, so the bot is the `@<username>` it
  // read from `/users/me`.
  mattermost: (adapter) =>
    nonEmpty(adapter.userName) ? [`@${adapter.userName}`] : [],
};

const escapeForRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every whole-word occurrence of an address goes, with the spaces after it;
 * a longer name that only starts with one (`@growi-admin`) stays. Line breaks
 * are kept: a multi-line answer depends on them.
 */
export const withoutBotAddresses = (
  text: string,
  addresses: readonly string[],
): string =>
  addresses
    .reduce(
      (remaining, address) =>
        remaining.replace(
          new RegExp(
            `(?<!\\w)${escapeForRegExp(address)}(?![\\w-])[ \\t]*`,
            'gi',
          ),
          '',
        ),
      text,
    )
    .trim();
