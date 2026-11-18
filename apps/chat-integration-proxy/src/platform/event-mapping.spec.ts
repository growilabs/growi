// Task 3.3: 「SDK のイベントを内部の表現へ変換する」.
//
// Two things are asserted here, and they are different questions:
//
//  1. **What comes out** -- the five `PlatformEvent` kinds are produced from
//     the shapes the Chat SDK really hands a handler, and an unaddressed
//     reply produces nothing at all (design.md: 「いまは呼びかけ無しの返信を
//     受け付けない」).
//  2. **What does NOT come out** -- 「SDK の型はここで止まる」. TypeScript
//     alone cannot show this: excess-property checking only fires on fresh
//     object literals, so `{ kind: 'mention', ...sdkThing }` would compile and
//     smuggle a live `Thread` / `adapter` back-reference across the boundary at
//     runtime. Every positive case therefore also asserts the produced object's
//     exact key set and that it carries no function value and no `adapter`
//     back-reference. `src/architecture.spec.ts`'s Chat SDK origin guard covers
//     the complementary half (no file outside `platform/**` may even name an SDK
//     type); neither implies the other.
import { createDiscordAdapter } from '@chat-adapter/discord';
import { createSlackAdapter } from '@chat-adapter/slack';
import { createTeamsAdapter } from '@chat-adapter/teams';
import type {
  ActionEvent,
  Adapter,
  Author,
  Channel,
  ChannelVisibility,
  LinkPreview,
  Message,
  ModalSubmitEvent,
  SlashCommandEvent,
  Thread,
} from 'chat';
import { createMattermostAdapter } from 'chat-adapter-mattermost';
import { mock } from 'vitest-mock-extended';

import type { InteractionRef, PlatformEvent } from '../types/index.js';
import {
  decodeActionId,
  encodeActionId,
  fromAction,
  fromMessage,
  fromModalSubmit,
  fromSlashCommand,
} from './event-mapping.js';

/**
 * A minted modal handle. It names the event's own `openModal()` closure (see
 * `prompt.ts`), so it is opaque here on purpose -- nothing in this file reads
 * inside it.
 */
const TRIGGER: InteractionRef = { token: 'trigger-1' };

const author = (overrides: Partial<Author> = {}): Author => ({
  userId: 'U0001',
  userName: 'alice',
  fullName: 'Alice Example',
  isBot: false,
  isMe: false,
  ...overrides,
});

const slackChannel = (name: string | null = 'general'): Channel =>
  mock<Channel>({ id: 'slack:C0001', name });

const slackThread = (
  overrides: {
    readonly channelId?: string;
    readonly isDM?: boolean;
    readonly channelVisibility?: ChannelVisibility;
    readonly channelName?: string | null;
  } = {},
): Thread =>
  mock<Thread>({
    adapter: mock({ name: 'slack', botUserId: 'U0BOT0001' }),
    channelId: overrides.channelId ?? 'slack:C0001',
    isDM: overrides.isDM ?? false,
    channelVisibility: overrides.channelVisibility ?? 'workspace',
    channel: slackChannel(
      'channelName' in overrides ? (overrides.channelName ?? null) : 'general',
    ),
  });

const message = (overrides: Partial<Message> = {}): Message =>
  mock<Message>({
    id: 'M0001',
    threadId: 'slack:C0001:1.0',
    text: '@growi search foo',
    author: author(),
    links: [],
    isMention: true,
    ...overrides,
  });

const link = (url: string): LinkPreview => ({
  url,
  title: 'Some page',
  fetchMessage: async () => message(),
});

/**
 * The invariant 「SDK の型はここで止まる」, checked on a produced event: its
 * keys are exactly what `PlatformEvent` declares for that kind, and no value
 * is a function or carries an `adapter` back-reference. A spread of an SDK
 * object would break at least one of these -- the mocks used above stub every
 * method, so a leaked `Thread` / `Message` / `Channel` shows up as function
 * values.
 */
const expectNoSdkValueLeaked = (
  event: PlatformEvent,
  expectedKeys: readonly string[],
): void => {
  expect(Object.keys(event).sort()).toEqual([...expectedKeys].sort());

  const walk = (value: unknown, path: string): void => {
    expect(typeof value, `${path} must not be a function`).not.toBe('function');
    if (value == null || typeof value !== 'object') return;
    expect(
      Object.hasOwn(value, 'adapter'),
      `${path} must not carry an SDK adapter back-reference`,
    ).toBe(false);
    for (const [key, child] of Object.entries(value)) {
      walk(child, `${path}.${key}`);
    }
  };
  walk(event, 'event');
};

describe('fromMessage', () => {
  it('turns an addressed message into a mention carrying the platform, channel, speaker and text', () => {
    const event = fromMessage(
      slackThread(),
      message({ text: '@U0BOT0001 search foo' }),
    );

    expect(event).toEqual({
      kind: 'mention',
      platform: 'slack',
      channel: {
        platform: 'slack',
        channelId: 'slack:C0001',
        channelName: 'general',
        isPrivate: false,
      },
      actor: {
        platform: 'slack',
        accountId: 'U0001',
        displayName: 'Alice Example',
      },
      text: '@U0BOT0001 search foo',
      textWithoutBotAddress: 'search foo',
      inDirectMessage: false,
      messageId: 'M0001',
      threadRootId: null,
      replyThreadRootId: null,
      // A message event never carries a modal trigger (design.md: 「mention の
      // 通知には付いてこない」).
      interaction: null,
    });
  });

  it('produces nothing for an unaddressed message, so a bare reply cannot reach the rest of the app', () => {
    // The reply exclusion, as a property of this function rather than of the
    // registration site: `PlatformEvent` has no `reply` kind, and there is no
    // other kind an unaddressed, link-free message could be forced into.
    const event = fromMessage(
      slackThread(),
      message({ isMention: false, text: '1' }),
    );

    expect(event).toBeNull();
  });

  it('turns an unaddressed message that carries URLs into link-posted, with the URLs but no command text', () => {
    const event = fromMessage(
      slackThread(),
      message({
        isMention: false,
        text: 'see https://growi.example.com/page',
        links: [link('https://growi.example.com/page')],
      }),
    );

    expect(event).toEqual({
      kind: 'link-posted',
      platform: 'slack',
      channel: {
        platform: 'slack',
        channelId: 'slack:C0001',
        channelName: 'general',
        isPrivate: false,
      },
      actor: {
        platform: 'slack',
        accountId: 'U0001',
        displayName: 'Alice Example',
      },
      messageRef: {
        channel: {
          platform: 'slack',
          channelId: 'slack:C0001',
          channelName: 'general',
          isPrivate: false,
        },
        messageId: 'M0001',
      },
      urls: ['https://growi.example.com/page'],
    });
  });

  it('keeps an addressed message that also carries URLs a mention, so its command is still read', () => {
    // Precedence matters: `link-posted` deliberately bypasses command parsing
    // (design.md: 「コマンドの解釈を通さない」), so demoting an addressed
    // message to `link-posted` would silently swallow the command.
    const event = fromMessage(
      slackThread(),
      message({
        isMention: true,
        text: '@growi search https://growi.example.com/page',
        links: [link('https://growi.example.com/page')],
      }),
    );

    expect(event?.kind).toBe('mention');
  });

  it('marks a direct message and a private channel as private, and a workspace channel as not', () => {
    const dm = fromMessage(slackThread({ isDM: true }), message());
    const priv = fromMessage(
      slackThread({ channelVisibility: 'private' }),
      message(),
    );
    const open = fromMessage(slackThread(), message());

    expect(dm?.channel.isPrivate).toBe(true);
    expect(priv?.channel.isPrivate).toBe(true);
    expect(open?.channel.isPrivate).toBe(false);
  });

  it('reports whether the mention was made inside a direct message, and carries the message id either way', () => {
    const inDm = fromMessage(
      slackThread({ isDM: true }),
      message({ id: 'M0002' }),
    );
    const inChannel = fromMessage(slackThread(), message({ id: 'M0003' }));

    expect(inDm).toMatchObject({
      kind: 'mention',
      inDirectMessage: true,
      messageId: 'M0002',
    });
    expect(inChannel).toMatchObject({
      kind: 'mention',
      inDirectMessage: false,
      messageId: 'M0003',
    });
  });

  it('still resolves the channel when the platform has not supplied a channel name yet', () => {
    // `Channel.name` is null until metadata has been fetched. The channel is
    // matched by id, never by name, so a missing name must not drop the event.
    const event = fromMessage(slackThread({ channelName: null }), message());

    expect(event?.channel.channelId).toBe('slack:C0001');
    expect(event?.channel.channelName).toBe('');
  });

  it('drops an event whose channel id is not in the adapter encoding it came from', () => {
    // Nothing downstream that converts the id can then throw on it.
    expect(
      fromMessage(slackThread({ channelId: 'C0001' }), message()),
    ).toBeNull();
  });

  it('falls back to the handle when the platform reports no display name', () => {
    const event = fromMessage(
      slackThread(),
      message({ author: author({ fullName: '' }) }),
    );

    expect(event?.actor.displayName).toBe('alice');
  });

  it('produces nothing for an adapter this proxy does not serve', () => {
    const foreign = mock<Thread>({
      adapter: mock({ name: 'whatsapp' }),
      channelId: 'slack:C0001',
      isDM: false,
      channelVisibility: 'workspace',
      channel: slackChannel(),
    });

    expect(fromMessage(foreign, message())).toBeNull();
  });

  it('lets no Chat SDK value through, for either kind it produces', () => {
    const mention = fromMessage(slackThread(), message());
    const linkPosted = fromMessage(
      slackThread(),
      message({ isMention: false, links: [link('https://example.com/a')] }),
    );

    expect(mention).not.toBeNull();
    expect(linkPosted).not.toBeNull();
    if (mention == null || linkPosted == null) return;
    expectNoSdkValueLeaked(mention, [
      'kind',
      'platform',
      'channel',
      'actor',
      'text',
      'textWithoutBotAddress',
      'inDirectMessage',
      'messageId',
      'threadRootId',
      'replyThreadRootId',
      'interaction',
    ]);
    expectNoSdkValueLeaked(linkPosted, [
      'kind',
      'platform',
      'channel',
      'actor',
      'messageRef',
      'urls',
    ]);
  });
});

// Requirements 15.8, 15.14 and 15.17, read off the four REAL adapters (built
// offline, never connected): each one's own thread ids and its own idea of who
// the bot is, so the cases follow what the adapters actually encode rather
// than a copy of it.
describe('fromMessage, on each service: where the answer goes and what was asked', () => {
  const SLACK_BOT = 'U0BOT0001';
  const DISCORD_APP = '900000000000000001';
  const TEAMS_BOT = '28:00000000-0000-0000-0000-00000000a99';
  const MATTERMOST_BOT_NAME = 'growi';

  const slack = createSlackAdapter({
    mode: 'socket',
    appToken: 'xapp-1-test',
    signingSecret: 'signing-secret',
    botUserId: SLACK_BOT,
  });
  const discord = createDiscordAdapter({
    applicationId: DISCORD_APP,
    publicKey: 'a'.repeat(64),
    botToken: 'discord-bot-token',
  });
  const teams = createTeamsAdapter({ appId: 'app', appPassword: 'password' });
  // `userName` is what the adapter takes from `/users/me` on connecting.
  const mattermost = createMattermostAdapter({
    baseUrl: 'http://mattermost.invalid',
    botToken: 'mattermost-bot-token',
    userName: MATTERMOST_BOT_NAME,
  });

  const threadOf = (
    adapter: Adapter,
    threadId: string,
    isDM: boolean,
  ): Thread => {
    const thread = mock<Thread>({
      id: threadId,
      channelId: adapter.channelIdFromThreadId(threadId),
      isDM,
      channelVisibility: isDM ? 'private' : 'workspace',
      channel: mock<Channel>({ name: 'general' }),
    });
    // Assigned rather than passed in: `mock()` would wrap the adapter in a
    // proxy, which cannot reach the adapter's private class fields.
    Object.assign(thread, { adapter });
    return thread;
  };

  const mentionFrom = (
    thread: Thread,
    overrides: Partial<Message>,
  ): Extract<PlatformEvent, { kind: 'mention' }> => {
    const event = fromMessage(thread, message(overrides));
    if (event?.kind !== 'mention') throw new Error(`got ${event?.kind}`);
    return event;
  };

  const teamsThreadId = (conversationId: string, personal = false): string =>
    teams.encodeThreadId({
      conversationId,
      serviceUrl: 'https://smba.trafficmanager.net/teams/',
      ...(personal ? { conversationType: 'personal' as const } : {}),
    });

  /**
   * A Teams activity as `message.raw`: the bot is its recipient. `text` is the
   * entity's own `<at>…</at>`, for a name Teams writes with HTML escapes.
   */
  const teamsActivity = (
    mentions: ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly text?: string;
    }>,
  ) => ({
    recipient: { id: TEAMS_BOT, name: 'GROWI' },
    entities: mentions.map(({ id, name, text }) => ({
      type: 'mention',
      text: text ?? `<at>${name}</at>`,
      mentioned: { id, name },
    })),
  });

  const slackChannelThread = () =>
    threadOf(slack, 'slack:C0001:1700000000.000100', false);
  const discordThread = () =>
    threadOf(
      discord,
      'discord:700000000000000001:710000000000000001:930000000000000001',
      false,
    );
  const teamsChannelThread = () =>
    threadOf(
      teams,
      teamsThreadId('19:general@thread.tacv2;messageid=1700000000111'),
      false,
    );
  const mattermostChannelThread = () =>
    threadOf(
      mattermost,
      mattermost.encodeThreadId({ channelId: 'channel1', rootPostId: 'post1' }),
      false,
    );

  describe('the text without the bot address (15.17)', () => {
    it.each([
      {
        service: 'Slack',
        thread: slackChannelThread,
        text: `@${SLACK_BOT} @Alice please review`,
        raw: {},
        expected: '@Alice please review',
      },
      {
        service: 'Discord',
        thread: discordThread,
        text: `<@${DISCORD_APP}> <@920000000000000002> please review`,
        raw: {},
        expected: '<@920000000000000002> please review',
      },
      {
        service: 'Teams',
        thread: teamsChannelThread,
        text: '@GROWI @Alice please review',
        raw: teamsActivity([
          { id: TEAMS_BOT, name: 'GROWI' },
          { id: '29:1alice', name: 'Alice' },
        ]),
        expected: '@Alice please review',
      },
      {
        service: 'Mattermost',
        thread: mattermostChannelThread,
        text: `@${MATTERMOST_BOT_NAME} @alice please review`,
        raw: {},
        expected: '@alice please review',
      },
    ])('$service: drops only the bot address and keeps the mention of another person that now leads the text', ({
      thread,
      text,
      raw,
      expected,
    }) => {
      const event = mentionFrom(thread(), { text, raw });

      expect(event.textWithoutBotAddress).toBe(expected);
      expect(event.text).toBe(text);
    });

    it.each([
      {
        service: 'Slack',
        thread: () => threadOf(slack, 'slack:D0001:', true),
        text: '@Alice please review',
        raw: {},
      },
      {
        service: 'Discord',
        thread: () => threadOf(discord, 'discord:@me:910000000000000001', true),
        text: '<@920000000000000002> please review',
        raw: {},
      },
      {
        service: 'Teams',
        thread: () => threadOf(teams, teamsThreadId('a:1direct', true), true),
        text: '@Alice please review',
        raw: teamsActivity([{ id: '29:1alice', name: 'Alice' }]),
      },
      {
        service: 'Mattermost',
        thread: () =>
          threadOf(
            mattermost,
            mattermost.encodeThreadId({ channelId: 'direct1' }),
            true,
          ),
        text: '@alice please review',
        raw: {},
      },
    ])('$service: leaves a direct message that starts with another person as typed', ({
      thread,
      text,
      raw,
    }) => {
      expect(mentionFrom(thread(), { text, raw }).textWithoutBotAddress).toBe(
        text,
      );
    });

    it('drops a bot address in the middle without leaving a double space, and keeps the line breaks after it', () => {
      const thread = threadOf(slack, 'slack:D0001:', true);

      expect(
        mentionFrom(thread, { text: `please @${SLACK_BOT} summarize` })
          .textWithoutBotAddress,
      ).toBe('please summarize');
      expect(
        mentionFrom(thread, { text: `@${SLACK_BOT}\nfirst line\n\nsecond` })
          .textWithoutBotAddress,
      ).toBe('first line\n\nsecond');
      expect(
        mentionFrom(thread, { text: `please\n@${SLACK_BOT}\nfirst` })
          .textWithoutBotAddress,
      ).toBe('please\n\nfirst');
    });

    it('drops every bot address in the text, not only the first', () => {
      expect(
        mentionFrom(slackChannelThread(), {
          text: `@${SLACK_BOT} please @${SLACK_BOT} summarize`,
        }).textWithoutBotAddress,
      ).toBe('please summarize');
    });

    it('Discord: drops the nickname form of the bot address too', () => {
      expect(
        mentionFrom(discordThread(), { text: `<@!${DISCORD_APP}> search foo` })
          .textWithoutBotAddress,
      ).toBe('search foo');
    });

    it('Mattermost: drops the bot address typed in another case, as usernames do not differ by case', () => {
      expect(
        mentionFrom(mattermostChannelThread(), {
          text: `@${MATTERMOST_BOT_NAME.toUpperCase()} search foo`,
        }).textWithoutBotAddress,
      ).toBe('search foo');
    });

    it("keeps the bot's name when it only ends a longer word, such as a login written as user@host", () => {
      expect(
        mentionFrom(mattermostChannelThread(), {
          text: `@${MATTERMOST_BOT_NAME} ask about deploy@${MATTERMOST_BOT_NAME} now`,
        }).textWithoutBotAddress,
      ).toBe(`ask about deploy@${MATTERMOST_BOT_NAME} now`);
    });

    it("does not take a longer name that merely starts with the bot's for the bot", () => {
      expect(
        mentionFrom(mattermostChannelThread(), {
          text: `@${MATTERMOST_BOT_NAME} ask @${MATTERMOST_BOT_NAME}-admin`,
        }).textWithoutBotAddress,
      ).toBe(`ask @${MATTERMOST_BOT_NAME}-admin`);
    });

    it("does not take a dotted username that merely starts with the bot's for the bot", () => {
      expect(
        mentionFrom(mattermostChannelThread(), {
          text: `@${MATTERMOST_BOT_NAME} ask @${MATTERMOST_BOT_NAME}.admin`,
        }).textWithoutBotAddress,
      ).toBe(`ask @${MATTERMOST_BOT_NAME}.admin`);
    });

    it('still takes the bot address when a sentence-ending period follows it', () => {
      expect(
        mentionFrom(mattermostChannelThread(), {
          text: `ask @${MATTERMOST_BOT_NAME}.`,
        }).textWithoutBotAddress,
      ).toBe('ask .');
    });

    it.each([
      'GROWI Admin',
      'GROWI太郎',
    ])("Teams: keeps the mention of %s, whose display name merely starts with the bot's", (name) => {
      expect(
        mentionFrom(teamsChannelThread(), {
          text: `@GROWI ask @${name}`,
          raw: teamsActivity([
            { id: TEAMS_BOT, name: 'GROWI' },
            { id: '29:1x', name },
          ]),
        }).textWithoutBotAddress,
      ).toBe(`ask @${name}`);
    });

    it("Teams: still drops the bot address when the bot's display name is the longer one", () => {
      expect(
        mentionFrom(teamsChannelThread(), {
          text: '@GROWI Admin ask @GROWI',
          raw: teamsActivity([
            { id: TEAMS_BOT, name: 'GROWI Admin' },
            { id: '29:1x', name: 'GROWI' },
          ]),
        }).textWithoutBotAddress,
      ).toBe('ask @GROWI');
    });

    it('drops a Teams address only when the mention names the bot itself, not a person with the same display name', () => {
      expect(
        mentionFrom(teamsChannelThread(), {
          text: '@GROWI please review',
          raw: teamsActivity([{ id: '29:1namesake', name: 'GROWI' }]),
        }).textWithoutBotAddress,
      ).toBe('@GROWI please review');
    });

    it("Teams: keeps a colleague's mention whose display name differs from the bot's only in case", () => {
      expect(
        mentionFrom(teamsChannelThread(), {
          text: '@GROWI admin 権限の手順を @GROWI Admin に送って',
          raw: teamsActivity([
            { id: TEAMS_BOT, name: 'GROWI' },
            { id: '29:1admin', name: 'GROWI Admin' },
          ]),
        }).textWithoutBotAddress,
      ).toBe('admin 権限の手順を @GROWI Admin に送って');
    });

    it("Teams: drops the bot address followed by the words of a colleague's name written in another case", () => {
      expect(
        mentionFrom(teamsChannelThread(), {
          text: '@GROWI Admin 権限について @Growi Admin に聞いて',
          raw: teamsActivity([
            { id: TEAMS_BOT, name: 'GROWI' },
            { id: '29:1admin', name: 'Growi Admin' },
          ]),
        }).textWithoutBotAddress,
      ).toBe('Admin 権限について @Growi Admin に聞いて');
    });

    it.each([
      { bot: 'GROWI', other: 'Growi' },
      { bot: 'growi bot', other: 'GROWI Bot' },
    ])('Teams: keeps the mention of $other, whose display name is the bot $bot in another case', ({
      bot,
      other,
    }) => {
      expect(
        mentionFrom(teamsChannelThread(), {
          text: `@${bot} ask @${other}`,
          raw: teamsActivity([
            { id: TEAMS_BOT, name: bot },
            { id: '29:1other', name: other },
          ]),
        }).textWithoutBotAddress,
      ).toBe(`ask @${other}`);
    });

    it.each([
      {
        service: 'Slack',
        thread: slackChannelThread,
        text: `@${SLACK_BOT}search foo`,
        expected: 'search foo',
      },
      {
        service: 'Slack',
        thread: slackChannelThread,
        text: `@${SLACK_BOT}-san search`,
        expected: '-san search',
      },
      {
        service: 'Discord',
        thread: discordThread,
        text: `<@${DISCORD_APP}>search`,
        expected: 'search',
      },
      {
        service: 'Discord',
        thread: discordThread,
        text: `<@${DISCORD_APP}>-san search`,
        expected: '-san search',
      },
    ])('$service: drops the bot address that ends where the bot id ends, in $text', ({
      thread,
      text,
      expected,
    }) => {
      expect(mentionFrom(thread(), { text }).textWithoutBotAddress).toBe(
        expected,
      );
    });

    it('Slack: keeps the bot id when it only ends a longer word', () => {
      expect(
        mentionFrom(slackChannelThread(), {
          text: `@${SLACK_BOT} ask about deploy@${SLACK_BOT} now`,
        }).textWithoutBotAddress,
      ).toBe(`ask about deploy@${SLACK_BOT} now`);
    });

    it('Slack: keeps the mention of a longer user id that starts with the bot id', () => {
      expect(
        mentionFrom(slackChannelThread(), {
          text: `@${SLACK_BOT} ask @${SLACK_BOT}2`,
        }).textWithoutBotAddress,
      ).toBe(`ask @${SLACK_BOT}2`);
    });

    it("Teams: keeps a hand-typed name that only starts with the bot's", () => {
      expect(
        mentionFrom(teamsChannelThread(), {
          text: '@GROWI ask @GROWIX',
          raw: teamsActivity([{ id: TEAMS_BOT, name: 'GROWI' }]),
        }).textWithoutBotAddress,
      ).toBe('ask @GROWIX');
    });

    it('Teams: drops the bot address whose display name Teams writes with an HTML escape', () => {
      expect(
        mentionFrom(teamsChannelThread(), {
          text: '@R&D Bot search',
          raw: teamsActivity([
            { id: TEAMS_BOT, name: 'R&D Bot', text: '<at>R&amp;D Bot</at>' },
          ]),
        }).textWithoutBotAddress,
      ).toBe('search');
    });

    it("Teams: keeps a colleague's mention, written with an HTML escape, whose display name starts with the bot's", () => {
      expect(
        mentionFrom(teamsChannelThread(), {
          text: '@GROWI ask @GROWI & Co',
          raw: teamsActivity([
            { id: TEAMS_BOT, name: 'GROWI' },
            {
              id: '29:1co',
              name: 'GROWI & Co',
              text: '<at>GROWI &amp; Co</at>',
            },
          ]),
        }).textWithoutBotAddress,
      ).toBe('ask @GROWI & Co');
    });

    it.each([
      {
        service: 'Slack',
        space: 'an ideographic space',
        thread: slackChannelThread,
        text: `ask @${SLACK_BOT}　検索`,
        raw: {},
      },
      {
        service: 'Teams',
        space: 'an ideographic space',
        thread: teamsChannelThread,
        text: 'ask @GROWI　検索',
        raw: teamsActivity([{ id: TEAMS_BOT, name: 'GROWI' }]),
      },
      {
        service: 'Mattermost',
        space: 'an ideographic space',
        thread: mattermostChannelThread,
        text: `ask @${MATTERMOST_BOT_NAME}　検索`,
        raw: {},
      },
      {
        service: 'Mattermost',
        space: 'a no-break space',
        thread: mattermostChannelThread,
        text: `ask @${MATTERMOST_BOT_NAME} 検索`,
        raw: {},
      },
    ])('$service: drops $space after the bot address too', ({
      thread,
      text,
      raw,
    }) => {
      expect(mentionFrom(thread(), { text, raw }).textWithoutBotAddress).toBe(
        'ask 検索',
      );
    });
  });

  describe('the two thread roots (15.8, 15.14)', () => {
    it.each([
      {
        place: 'a Slack channel, outside a thread',
        thread: slackChannelThread,
        messageId: '1700000000.000100',
        threadRootId: null,
        replyThreadRootId: null,
      },
      {
        place: 'a Slack channel, inside a thread',
        thread: slackChannelThread,
        messageId: '1700000000.000200',
        threadRootId: '1700000000.000100',
        replyThreadRootId: '1700000000.000100',
      },
      {
        place: 'a Slack DM with the AI app view off, outside a thread',
        thread: () => threadOf(slack, 'slack:D0001:', true),
        messageId: '1700000000.000300',
        threadRootId: null,
        replyThreadRootId: '1700000000.000300',
      },
      {
        place: 'a Slack DM, replying in the thread of an earlier request',
        thread: () => threadOf(slack, 'slack:D0001:1700000000.000300', true),
        messageId: '1700000000.000400',
        threadRootId: '1700000000.000300',
        replyThreadRootId: '1700000000.000300',
      },
      {
        place:
          'a Slack DM with the AI app view on, where each message roots its own thread',
        thread: () => threadOf(slack, 'slack:D0001:1700000000.000500', true),
        messageId: '1700000000.000500',
        threadRootId: null,
        replyThreadRootId: '1700000000.000500',
      },
      {
        place:
          'a Discord channel, in the thread the adapter started from the message',
        thread: discordThread,
        messageId: '930000000000000001',
        threadRootId: null,
        replyThreadRootId: null,
      },
      {
        place: 'a Discord thread, replying',
        thread: discordThread,
        messageId: '930000000000000002',
        threadRootId: '930000000000000001',
        replyThreadRootId: '930000000000000001',
      },
      {
        place: 'a Discord DM, which has no threads',
        thread: () => threadOf(discord, 'discord:@me:910000000000000001', true),
        messageId: '930000000000000003',
        threadRootId: null,
        replyThreadRootId: null,
      },
      {
        place: 'a Teams channel, outside a thread',
        thread: teamsChannelThread,
        messageId: '1700000000111',
        threadRootId: null,
        replyThreadRootId: null,
      },
      {
        place: 'a Teams channel, inside a thread',
        thread: teamsChannelThread,
        messageId: '1700000000222',
        threadRootId: '1700000000111',
        replyThreadRootId: '1700000000111',
      },
      {
        place: 'a Teams DM, which has no reply hierarchy',
        thread: () => threadOf(teams, teamsThreadId('a:1direct', true), true),
        messageId: '1700000000333',
        threadRootId: null,
        replyThreadRootId: null,
      },
      {
        place: 'a Mattermost channel, outside a thread',
        thread: mattermostChannelThread,
        messageId: 'post1',
        threadRootId: null,
        replyThreadRootId: null,
      },
      {
        place: 'a Mattermost channel, inside a thread',
        thread: mattermostChannelThread,
        messageId: 'post2',
        threadRootId: 'post1',
        replyThreadRootId: 'post1',
      },
      {
        place: 'a Mattermost DM, outside a thread',
        thread: () =>
          threadOf(
            mattermost,
            mattermost.encodeThreadId({
              channelId: 'direct1',
              rootPostId: 'post3',
            }),
            true,
          ),
        messageId: 'post3',
        threadRootId: null,
        replyThreadRootId: 'post3',
      },
    ])('$place', ({ thread, messageId, threadRootId, replyThreadRootId }) => {
      const event = mentionFrom(thread(), { id: messageId, text: 'help' });

      expect(event).toMatchObject({
        messageId,
        threadRootId,
        replyThreadRootId,
      });
    });
  });

  it('tells GROWI a direct message is one through the channel it names, and says nothing for a channel', () => {
    const inDm = mentionFrom(threadOf(slack, 'slack:D0001:', true), {
      text: 'help',
    });
    const inChannel = mentionFrom(slackChannelThread(), { text: 'help' });

    expect(inDm.channel.isDirectMessage).toBe(true);
    expect(inDm.inDirectMessage).toBe(true);
    expect(inChannel.channel).not.toHaveProperty('isDirectMessage');
    expect(inChannel.inDirectMessage).toBe(false);
  });
});

describe('fromSlashCommand', () => {
  const slashCommandEvent = (
    overrides: Partial<SlashCommandEvent> = {},
  ): SlashCommandEvent =>
    mock<SlashCommandEvent>({
      adapter: mock({ name: 'slack' }),
      channel: mock<Channel>({
        id: 'slack:C0001',
        name: 'general',
        isDM: false,
        channelVisibility: 'workspace',
      }),
      command: '/growi',
      text: 'search foo',
      triggerId: 'trigger-1',
      user: author(),
      ...overrides,
    });

  it('turns a slash command into a slash-command event carrying the command, its arguments and the modal handle', () => {
    const event = fromSlashCommand(slashCommandEvent(), TRIGGER);

    expect(event).toEqual({
      kind: 'slash-command',
      platform: 'slack',
      channel: {
        platform: 'slack',
        channelId: 'slack:C0001',
        channelName: 'general',
        isPrivate: false,
      },
      actor: {
        platform: 'slack',
        accountId: 'U0001',
        displayName: 'Alice Example',
      },
      command: '/growi',
      text: 'search foo',
      interaction: TRIGGER,
    });
  });

  it('still delivers the command when there is no way to open a modal', () => {
    // The handle names the event's own `openModal()` closure (see
    // `prompt.ts`), so it is passed in rather than read off the event.
    // Dropping the event when there is none would make the whole command
    // unusable on a service that cannot show a modal, so the absence is
    // reported instead.
    const event = fromSlashCommand(slashCommandEvent(), null);

    expect(event?.kind).toBe('slash-command');
    expect(event).toMatchObject({ interaction: null });
  });

  it('carries the modal handle it was given even when the platform sent no trigger id', () => {
    // Teams' `modal` capability is `full` and its events never carry a
    // trigger id, so reading one off the event would make every Teams
    // invocation look modal-less. The handle names the event's own
    // `openModal()` closure instead (see `prompt.ts`).
    const event = fromSlashCommand(
      slashCommandEvent({ triggerId: undefined }),
      TRIGGER,
    );

    expect(event).toMatchObject({ interaction: TRIGGER });
  });

  it('produces nothing for an adapter this proxy does not serve', () => {
    expect(
      fromSlashCommand(
        slashCommandEvent({ adapter: mock({ name: 'whatsapp' }) }),
        TRIGGER,
      ),
    ).toBeNull();
  });

  it('lets no Chat SDK value through', () => {
    const event = fromSlashCommand(slashCommandEvent(), TRIGGER);

    expect(event).not.toBeNull();
    if (event == null) return;
    expectNoSdkValueLeaked(event, [
      'kind',
      'platform',
      'channel',
      'actor',
      'command',
      'text',
      'interaction',
    ]);
  });
});

describe('encodeActionId / decodeActionId', () => {
  it('round-trips the correlation id and the action id through the one slot a button carries', () => {
    const encoded = encodeActionId('corr-1', 'choose-growi');

    expect(decodeActionId(encoded)).toEqual({
      correlationId: 'corr-1',
      actionId: 'choose-growi',
    });
  });

  it('round-trips an action id containing the separator', () => {
    const encoded = encodeActionId('corr-1', 'choose:growi:2');

    expect(decodeActionId(encoded)).toEqual({
      correlationId: 'corr-1',
      actionId: 'choose:growi:2',
    });
  });

  it('rejects an id that this proxy did not encode, rather than inventing a correlation id', () => {
    expect(decodeActionId('choose-growi')).toBeNull();
    expect(decodeActionId('growi-action:corr-1')).toBeNull();
    expect(decodeActionId('growi-action::choose')).toBeNull();
    expect(decodeActionId('growi-action:corr-1:')).toBeNull();
  });
});

describe('fromAction', () => {
  const actionEvent = (overrides: Partial<ActionEvent> = {}): ActionEvent =>
    mock<ActionEvent>({
      actionId: encodeActionId('corr-1', 'choose-growi'),
      adapter: mock({ name: 'slack' }),
      messageId: 'M0001',
      thread: slackThread(),
      threadId: 'slack:C0001:1.0',
      triggerId: 'trigger-1',
      user: author(),
      value: 'growi-a',
      ...overrides,
    });

  it('turns a button press into an action event carrying the correlation id, the action and its value', () => {
    const event = fromAction(actionEvent(), TRIGGER);

    expect(event).toEqual({
      kind: 'action',
      platform: 'slack',
      channel: {
        platform: 'slack',
        channelId: 'slack:C0001',
        channelName: 'general',
        isPrivate: false,
      },
      actor: {
        platform: 'slack',
        accountId: 'U0001',
        displayName: 'Alice Example',
      },
      correlationId: 'corr-1',
      actionId: 'choose-growi',
      value: 'growi-a',
      interaction: TRIGGER,
    });
  });

  it('reports a button carrying no payload as no value rather than as an empty string', () => {
    const event = fromAction(actionEvent({ value: undefined }), TRIGGER);

    expect(event).toMatchObject({ value: null });
  });

  it('still delivers the press when there is no way to open a modal', () => {
    const event = fromAction(actionEvent(), null);

    expect(event?.kind).toBe('action');
    expect(event).toMatchObject({ interaction: null });
  });

  it('produces nothing for a button this proxy did not encode', () => {
    // A leftover button from an older deploy: guessing a correlation id here
    // would resume someone else's collection.
    expect(
      fromAction(actionEvent({ actionId: 'approve' }), TRIGGER),
    ).toBeNull();
  });

  it('produces nothing for a press with no conversation behind it', () => {
    // Home-tab buttons arrive with `thread: null`; there is no channel to
    // answer in.
    expect(fromAction(actionEvent({ thread: null }), TRIGGER)).toBeNull();
  });

  it('lets no Chat SDK value through', () => {
    const event = fromAction(actionEvent(), TRIGGER);

    expect(event).not.toBeNull();
    if (event == null) return;
    expectNoSdkValueLeaked(event, [
      'kind',
      'platform',
      'channel',
      'actor',
      'correlationId',
      'actionId',
      'value',
      'interaction',
    ]);
  });
});

describe('fromModalSubmit', () => {
  const modalSubmitEvent = (
    overrides: Partial<ModalSubmitEvent> = {},
  ): ModalSubmitEvent =>
    mock<ModalSubmitEvent>({
      adapter: mock({ name: 'slack' }),
      callbackId: 'growi-args',
      privateMetadata: 'corr-1',
      user: author(),
      values: { path: '/Sandbox', comment: 'hello' },
      viewId: 'V0001',
      relatedThread: slackThread(),
      ...overrides,
    });

  it('turns a modal submission into a modal-submit event carrying the correlation id and the collected values', () => {
    const event = fromModalSubmit(modalSubmitEvent());

    expect(event).toEqual({
      kind: 'modal-submit',
      platform: 'slack',
      channel: {
        platform: 'slack',
        channelId: 'slack:C0001',
        channelName: 'general',
        isPrivate: false,
      },
      actor: {
        platform: 'slack',
        accountId: 'U0001',
        displayName: 'Alice Example',
      },
      correlationId: 'corr-1',
      values: { path: '/Sandbox', comment: 'hello' },
    });
  });

  it('copies the collected values instead of handing over the SDK payload object', () => {
    const values = { path: '/Sandbox' };
    const event = fromModalSubmit(modalSubmitEvent({ values }));

    expect(event).toMatchObject({ values: { path: '/Sandbox' } });
    expect(event?.kind === 'modal-submit' && event.values).not.toBe(values);
  });

  it('resolves the channel from the channel the modal was opened from when there is no thread', () => {
    const event = fromModalSubmit(
      modalSubmitEvent({
        relatedThread: undefined,
        relatedChannel: mock<Channel>({
          id: 'slack:C0002',
          name: 'random',
          isDM: false,
          channelVisibility: 'private',
        }),
      }),
    );

    expect(event?.channel).toEqual({
      platform: 'slack',
      channelId: 'slack:C0002',
      channelName: 'random',
      isPrivate: true,
    });
  });

  it('produces nothing for a submission that carries no correlation id', () => {
    expect(
      fromModalSubmit(modalSubmitEvent({ privateMetadata: undefined })),
    ).toBeNull();
    expect(
      fromModalSubmit(modalSubmitEvent({ privateMetadata: '' })),
    ).toBeNull();
  });

  it('produces nothing for a submission with no conversation behind it', () => {
    expect(
      fromModalSubmit(
        modalSubmitEvent({
          relatedThread: undefined,
          relatedChannel: undefined,
        }),
      ),
    ).toBeNull();
  });

  it('lets no Chat SDK value through', () => {
    const event = fromModalSubmit(modalSubmitEvent());

    expect(event).not.toBeNull();
    if (event == null) return;
    expectNoSdkValueLeaked(event, [
      'kind',
      'platform',
      'channel',
      'actor',
      'correlationId',
      'values',
    ]);
  });
});
