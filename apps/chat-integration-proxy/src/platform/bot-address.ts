// Taking the bot's own address out of a message's text (Requirement 15.17,
// research.md's Decision on the platform layer removing it). Each service
// puts a different form of the bot into `Message.text`, and only the adapter
// knows the bot, so the forms are declared per service below; mentions of
// anyone else are left exactly as typed.
import type { PlatformName } from '@growi/chat';
import type { Adapter, Message } from 'chat';

export interface AddressesInMessage {
  /** The forms the bot's own address takes in `message.text`. */
  readonly bot: readonly string[];
  /**
   * Mentions of anyone else, as they appear in `message.text`, for a service
   * whose names cannot be told apart from the text alone.
   */
  readonly others: readonly string[];
}

export type BotAddressReading = (
  adapter: Adapter,
  message: Message,
) => AddressesInMessage;

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  value != null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};

const botOnly = (bot: readonly string[]): AddressesInMessage => ({
  bot,
  others: [],
});

const TEAMS_MENTION_TEXT = /^<at>(.+)<\/at>$/;

/**
 * Teams writes a mention as `@<the name in its <at> tag>`, and that name is the
 * app's display name in Teams, which the adapter is never told. The activity's
 * mention entities say which `<at>` tag names the bot: the one whose
 * `mentioned.id` is the activity's recipient. A display name may hold spaces
 * and any letter (`GROWI Admin`, `GROWI太郎`), so the text alone cannot show
 * where a person's name that starts with the bot's ends; the other entities
 * say so instead.
 */
const teamsAddresses: BotAddressReading = (_adapter, message) => {
  const activity = asRecord(message.raw);
  const botId = asRecord(activity.recipient).id;
  const entities = Array.isArray(activity.entities) ? activity.entities : [];
  if (!nonEmpty(botId)) return botOnly([]);
  const mentions = entities.flatMap((entity: unknown) => {
    const { type, text, mentioned } = asRecord(entity);
    if (type !== 'mention') return [];
    const name = typeof text === 'string' && TEAMS_MENTION_TEXT.exec(text)?.[1];
    return nonEmpty(name)
      ? [{ address: `@${name}`, isBot: asRecord(mentioned).id === botId }]
      : [];
  });
  return {
    bot: mentions.filter((m) => m.isBot).map((m) => m.address),
    others: mentions.filter((m) => !m.isBot).map((m) => m.address),
  };
};

/** One entry per `PlatformName`; a missing service will not compile. */
export const BOT_ADDRESS_READINGS: Readonly<
  Record<PlatformName, BotAddressReading>
> = {
  // The adapter leaves its own `<@U…>` as `@U…`, and renders everyone else
  // by display name.
  slack: (adapter) => {
    const id = adapter.botUserId;
    return botOnly(nonEmpty(id) ? [`@${id}`] : []);
  },
  // `botUserId` is the application id; the text keeps Discord's own markup.
  discord: (adapter) => {
    const id = adapter.botUserId;
    return botOnly(nonEmpty(id) ? [`<@${id}>`, `<@!${id}>`] : []);
  },
  teams: teamsAddresses,
  // The adapter never rewrites a post, so the bot is the `@<username>` it
  // read from `/users/me`.
  mattermost: (adapter) =>
    botOnly(nonEmpty(adapter.userName) ? [`@${adapter.userName}`] : []),
};

const escapeForRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The rest of each other mention that is longer than `address` but starts
 * with it: where one of these follows, the address is the head of that
 * person's name, not the bot.
 */
const longerNameTails = (
  address: string,
  others: readonly string[],
): readonly string[] =>
  others
    .filter(
      (other) =>
        other.length > address.length &&
        other.slice(0, address.length).toLowerCase() === address.toLowerCase(),
    )
    .map((other) => other.slice(address.length));

/**
 * Every whole-word occurrence of an address goes, with the spaces after it;
 * a longer name that only starts with one (`@growi-admin`, `@growi.admin`,
 * or another mention in `others`) stays. Line breaks are kept: a multi-line
 * answer depends on them.
 */
export const withoutBotAddresses = (
  text: string,
  { bot, others }: AddressesInMessage,
): string =>
  bot
    .reduce((remaining, address) => {
      const notFollowedBy = [
        '[\\w-]',
        '\\.\\w',
        ...longerNameTails(address, others).map(escapeForRegExp),
      ].join('|');
      return remaining.replace(
        new RegExp(
          `(?<!\\w)${escapeForRegExp(address)}(?!${notFollowedBy})[ \\t]*`,
          'gi',
        ),
        '',
      );
    }, text)
    .trim();
