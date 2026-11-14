// Taking the bot's own address out of a message's text (Requirement 15.17,
// research.md's Decision on the platform layer removing it). Each service
// puts a different form of the bot into `Message.text` and compares names by
// its own rules, and only the adapter knows the bot, so both the forms and
// those rules are declared per service below; mentions of anyone else are
// left exactly as typed.
import { TeamsFormatConverter } from '@chat-adapter/teams';
import type { PlatformName } from '@growi/chat';
import type { Adapter, Message } from 'chat';

/**
 * Regex sources for one character that, right before or right after an
 * address, makes it part of a longer word or name. `''` means no check, as
 * for a form that closes itself (Discord's `<@id>`).
 */
export interface NameBoundary {
  readonly continuesBefore: string;
  readonly continuesAfter: string;
}

export interface AddressesInMessage {
  /** The forms the bot's own address takes in `message.text`. */
  readonly bot: readonly string[];
  /**
   * Mentions of anyone else, as they appear in `message.text`, for a service
   * whose names cannot be told apart from the text alone.
   */
  readonly others: readonly string[];
  /** Whether the service treats names that differ only in case as one. */
  readonly ignoreCase: boolean;
  readonly boundary: NameBoundary;
}

export type BotAddressReading = (
  adapter: Adapter,
  message: Message,
) => AddressesInMessage;

type NameRule = Pick<AddressesInMessage, 'ignoreCase' | 'boundary'>;

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  value != null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};

const botOnly = (
  bot: readonly string[],
  rule: NameRule,
): AddressesInMessage => ({ bot, others: [], ...rule });

/** A username may hold `-` and `.` (`@growi-admin`, `@growi.admin`). */
const USERNAME_BOUNDARY: NameBoundary = {
  continuesBefore: '\\w',
  continuesAfter: '[\\w-]|\\.\\w',
};

const SLACK_RULE: NameRule = {
  ignoreCase: false,
  // The bot keeps its upper-case user id, so only an id character continues
  // it: `@U0BOT0001search` is the bot followed by a word.
  boundary: { continuesBefore: '\\w', continuesAfter: '[A-Z0-9_]' },
};

const DISCORD_RULE: NameRule = {
  ignoreCase: false,
  boundary: { continuesBefore: '\\w', continuesAfter: '' },
};

const TEAMS_RULE: NameRule = {
  ignoreCase: false,
  boundary: USERNAME_BOUNDARY,
};

const MATTERMOST_RULE: NameRule = {
  ignoreCase: true,
  boundary: USERNAME_BOUNDARY,
};

const TEAMS_MENTION_TEXT = /^<at>.+<\/at>$/;

// The converter the adapter makes `message.text` with, so a name holding an
// HTML escape or a markdown character reads here as it does in the text.
const teamsText = new TeamsFormatConverter();

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
  if (!nonEmpty(botId)) return botOnly([], TEAMS_RULE);
  const mentions = entities.flatMap((entity: unknown) => {
    const { type, text, mentioned } = asRecord(entity);
    if (
      type !== 'mention' ||
      typeof text !== 'string' ||
      !TEAMS_MENTION_TEXT.test(text)
    ) {
      return [];
    }
    const address = teamsText.extractPlainText(text);
    return address.length > 1
      ? [{ address, isBot: asRecord(mentioned).id === botId }]
      : [];
  });
  return {
    bot: mentions.filter((m) => m.isBot).map((m) => m.address),
    others: mentions.filter((m) => !m.isBot).map((m) => m.address),
    ...TEAMS_RULE,
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
    return botOnly(nonEmpty(id) ? [`@${id}`] : [], SLACK_RULE);
  },
  // `botUserId` is the application id; the text keeps Discord's own markup.
  discord: (adapter) => {
    const id = adapter.botUserId;
    return botOnly(nonEmpty(id) ? [`<@${id}>`, `<@!${id}>`] : [], DISCORD_RULE);
  },
  teams: teamsAddresses,
  // The adapter never rewrites a post, so the bot is the `@<username>` it
  // read from `/users/me`.
  mattermost: (adapter) =>
    botOnly(
      nonEmpty(adapter.userName) ? [`@${adapter.userName}`] : [],
      MATTERMOST_RULE,
    ),
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
  ignoreCase: boolean,
): readonly string[] =>
  others
    .filter(
      (other) =>
        other.length > address.length &&
        (ignoreCase
          ? other.slice(0, address.length).toLowerCase() ===
            address.toLowerCase()
          : other.startsWith(address)),
    )
    .map((other) => other.slice(address.length));

/**
 * Every whole occurrence of an address goes, with the spaces after it; an
 * address that the service's boundary or another mention in `others` shows to
 * be the head of a longer name stays. Line breaks are kept: a multi-line
 * answer depends on them.
 */
export const withoutBotAddresses = (
  text: string,
  { bot, others, ignoreCase, boundary }: AddressesInMessage,
): string =>
  bot
    .reduce((remaining, address) => {
      const notFollowedBy = [
        boundary.continuesAfter,
        ...longerNameTails(address, others, ignoreCase).map(escapeForRegExp),
      ].filter(nonEmpty);
      const before = nonEmpty(boundary.continuesBefore)
        ? `(?<!${boundary.continuesBefore})`
        : '';
      const after =
        notFollowedBy.length > 0 ? `(?!${notFollowedBy.join('|')})` : '';
      return remaining.replace(
        new RegExp(
          `${before}${escapeForRegExp(address)}${after}[^\\S\\r\\n]*`,
          ignoreCase ? 'gi' : 'g',
        ),
        '',
      );
    }, text)
    .trim();
