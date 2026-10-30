// Task 3.4: 「投稿と差し替えを扱う」 -- post / postEphemeral / attachPreview /
// replace, plus the capability-driven choice of a lesser rendering on a
// service whose capability row is not `full`.
//
// What is asserted here is the observable contract of those four operations:
// which SDK call each one makes, what `PostOutcome` comes back, and -- for the
// rendering -- what a reader of the message can actually see. The Chat SDK's
// own posting behavior is third-party code and is not re-tested; where the
// thread-id format is at stake the assertion is a round trip through the
// *real* adapter (`channelIdFromThreadId`), never a hard-coded string, so the
// test cannot drift into re-stating an adapter's private encoding.
import {
  cardToDiscordPayload,
  createDiscordAdapter,
} from '@chat-adapter/discord';
import { cardToBlockKit, createSlackAdapter } from '@chat-adapter/slack';
import { cardToAdaptiveCard, createTeamsAdapter } from '@chat-adapter/teams';
import type { ChatAccountRef, PlatformName } from '@growi/chat';
import {
  type Adapter,
  type CardElement,
  isLinkNode,
  parseMarkdown,
  type StateAdapter,
  walkAst,
} from 'chat';
import {
  createMattermostAdapter,
  MattermostFormatConverter,
  type MattermostPost,
} from 'chat-adapter-mattermost';
import { mock } from 'vitest-mock-extended';

import { toSdkChannelId } from '../capabilities/index.js';
import type {
  OutboundMessage,
  SdkChannelId,
  SdkChannelRef,
  SdkMessageRef,
} from '../types/index.js';
import { decodeActionId } from './event-mapping.js';
import {
  addReaction,
  attachPreview,
  channelAccessFailure,
  channelThreadId,
  classifyOutboundFailure,
  type OutboundContext,
  post,
  postDirect,
  postEphemeral,
  replace,
  toPostable,
} from './outbound.js';

const BOT_NAME = 'growi';

/**
 * The real shape a Slack failure arrives in. `@chat-adapter/slack` rethrows
 * `@slack/web-api`'s own error untouched (its `handleSlackError` re-maps only
 * rate limiting), and that error is a plain `Error` carrying
 * `code: 'slack_webapi_platform_error'` with the API's name under `data.error`.
 * There is no `SlackApiError` class anywhere in the adapter -- an earlier
 * version of this test asserted one, and so never exercised the Slack arm.
 */
const slackPlatformError = (error: string) =>
  Object.assign(new Error(`An API error occurred: ${error}`), {
    code: 'slack_webapi_platform_error',
    data: { ok: false, error },
  });

/** `@chat-adapter/shared`'s errors: a `name` and the adapter that threw. */
const adapterError = (name: string, adapter: string, message: string) =>
  Object.assign(new Error(message), { name, adapter });

const channelOf = (
  platform: PlatformName,
  channelId: string,
): SdkChannelRef => ({
  platform,
  channelId: toSdkChannelId(platform, channelId),
  channelName: 'general',
  isPrivate: false,
});

/**
 * `Required<Adapter>` rather than `Adapter`: the SDK marks the optional
 * capabilities (`postChannelMessage`, `postEphemeral`, `openDM`) as `?`, and a
 * mock of the optional shape is typed as possibly-undefined, which no amount of
 * stubbing removes. A test that wants one of those *absent* removes it
 * explicitly instead (see the direct-message fallback below).
 */
const adapterMock = () => mock<Required<Adapter>>();

const contextOf = (adapter: Adapter): OutboundContext => ({
  adapter,
  state: mock<StateAdapter>(),
  botName: BOT_NAME,
});

const MARKDOWN: OutboundMessage = {
  kind: 'markdown',
  markdown: 'hello **world**',
};

const LIST: OutboundMessage = {
  kind: 'list',
  title: '検索結果',
  rows: [
    {
      primary: { kind: 'link', label: 'foo', url: 'https://growi.example/foo' },
      detail: '/team/foo',
      sourceLabel: 'wiki-a',
    },
    {
      primary: { kind: 'link', label: 'bar', url: 'https://growi.example/bar' },
      sourceLabel: 'wiki-b',
    },
  ],
  footer: '3 件中 2 件',
};

/** Every row from one GROWI, as when only one GROWI contributed results. */
const SINGLE_SOURCE_LIST: OutboundMessage = {
  kind: 'list',
  title: '検索結果',
  rows: [
    {
      primary: { kind: 'link', label: 'foo', url: 'https://growi.example/foo' },
      sourceLabel: 'Only GROWI',
    },
    {
      primary: { kind: 'link', label: 'bar', url: 'https://growi.example/bar' },
      sourceLabel: 'Only GROWI',
    },
  ],
};

/** A help list: rows whose primary content is markdown, not a link. */
const TEXT_LIST: OutboundMessage = {
  kind: 'list',
  title: 'コマンド',
  rows: [
    {
      primary: { kind: 'text', markdown: '`search <word>` — searches pages' },
      sourceLabel: 'wiki-a',
    },
    {
      primary: { kind: 'text', markdown: '`help` — lists commands' },
      sourceLabel: 'wiki-b',
    },
  ],
};

const CHOICE: OutboundMessage = {
  kind: 'choice',
  prompt: 'どの GROWI へ送りますか?',
  correlationId: 'corr-1',
  options: [
    { id: 'relation-a', label: 'wiki-a' },
    { id: 'relation-b', label: 'wiki-b' },
  ],
};

// Kept at their concrete types so a test can spy on a method `Adapter` marks
// optional (`postEphemeral`, `openDM`).
const slackAdapter = createSlackAdapter({
  mode: 'socket',
  appToken: 'xapp-1',
  signingSecret: 's',
});
const discordAdapter = createDiscordAdapter({
  applicationId: 'app-id',
  publicKey: '0'.repeat(64),
  botToken: 'bot-token',
});
const mattermostAdapter = createMattermostAdapter({
  baseUrl: 'https://mattermost.example.com',
  botToken: 'mm-token',
});

/** The four real adapters, constructible without any I/O (see adapter-set.spec.ts). */
const realAdapters: Readonly<Record<PlatformName, Adapter>> = {
  slack: slackAdapter,
  discord: discordAdapter,
  teams: createTeamsAdapter({
    appId: 'teams-app',
    appPassword: 'teams-secret',
  }),
  mattermost: mattermostAdapter,
};

/**
 * A channel id in exactly the form the rest of the app sees it: `event-mapping.ts`
 * reads `Thread.channelId`, which the SDK derives with `channelIdFromThreadId`.
 */
const realChannelIdOf = (
  platform: PlatformName,
  adapter: Adapter,
  threadId: string,
) => toSdkChannelId(platform, adapter.channelIdFromThreadId(threadId));

const realChannelIds: Readonly<Record<PlatformName, SdkChannelId>> = {
  slack: realChannelIdOf(
    'slack',
    realAdapters.slack,
    realAdapters.slack.encodeThreadId({
      channel: 'C123',
      threadTs: '1700000000.000100',
    }),
  ),
  discord: realChannelIdOf(
    'discord',
    realAdapters.discord,
    realAdapters.discord.encodeThreadId({
      guildId: 'G1',
      channelId: 'C1',
      threadId: 'T1',
    }),
  ),
  teams: realChannelIdOf(
    'teams',
    realAdapters.teams,
    realAdapters.teams.encodeThreadId({
      conversationId: '19:abc@thread.tacv2',
      serviceUrl: 'https://smba.example.com/',
    }),
  ),
  mattermost: realChannelIdOf(
    'mattermost',
    realAdapters.mattermost,
    realAdapters.mattermost.encodeThreadId({
      channelId: 'mmchan1',
      rootPostId: 'root1',
    }),
  ),
};

const PLATFORMS: ReadonlyArray<PlatformName> = [
  'slack',
  'discord',
  'teams',
  'mattermost',
];

const isCard = (postable: unknown): postable is CardElement =>
  typeof postable === 'object' &&
  postable !== null &&
  'type' in postable &&
  (postable as { type: unknown }).type === 'card';

const markdownOf = (postable: unknown): string => {
  if (
    typeof postable === 'object' &&
    postable !== null &&
    'markdown' in postable
  ) {
    return String((postable as { markdown: unknown }).markdown);
  }
  throw new Error(
    `expected a markdown postable, got ${JSON.stringify(postable)}`,
  );
};

/** Every button id anywhere inside a card, in document order. */
const buttonIdsOf = (card: CardElement): readonly string[] =>
  card.children.flatMap((child) =>
    child.type === 'actions'
      ? child.children.flatMap((action) =>
          action.type === 'button' ? [action.id] : [],
        )
      : [],
  );

/** Each card service's own conversion: what its API receives from the adapter. */
const CARD_RENDERERS: Readonly<
  Record<Exclude<PlatformName, 'mattermost'>, (card: CardElement) => unknown>
> = {
  slack: cardToBlockKit,
  discord: (card) => cardToDiscordPayload(card),
  teams: (card) => cardToAdaptiveCard(card).body,
};

/** Everything a reader of `message` on `platform` is sent, as one string. */
const renderedOn = (
  platform: PlatformName,
  message: OutboundMessage,
): string => {
  const postable = toPostable(message, platform, BOT_NAME);
  if (!isCard(postable)) return markdownOf(postable);
  if (platform === 'mattermost') {
    throw new Error('mattermost is expected to receive markdown');
  }
  return JSON.stringify(CARD_RENDERERS[platform](postable));
};

describe('toPostable -- the capability table decides the rendering, not the service name', () => {
  it('renders a markdown message as markdown on every service', () => {
    for (const platform of PLATFORMS) {
      expect(markdownOf(toPostable(MARKDOWN, platform, BOT_NAME))).toBe(
        'hello **world**',
      );
    }
  });

  it('renders a link row as a link each card service draws, never as raw markdown link text', () => {
    // What the reader sees is what each adapter turns the card into, so the
    // assertion runs on that output rather than on the card itself.
    const slack = renderedOn('slack', LIST);
    expect(slack).toContain('<https://growi.example/foo|foo>');
    expect(slack).not.toContain('](');

    for (const platform of ['discord', 'teams'] as const) {
      expect(renderedOn(platform, LIST)).toContain(
        '[foo](https://growi.example/foo)',
      );
    }
  });

  it('keeps every row, its detail and its GROWI name when the rows come from several GROWI', () => {
    for (const platform of PLATFORMS) {
      const rendered = renderedOn(platform, LIST);
      expect(rendered).toContain('検索結果');
      expect(rendered).toContain('/team/foo');
      expect(rendered).toContain('wiki-a');
      expect(rendered).toContain('wiki-b');
      expect(rendered).toContain('bar');
      expect(rendered).toContain('3 件中 2 件');
    }
  });

  it('names a single GROWI once instead of on every row', () => {
    for (const platform of PLATFORMS) {
      const rendered = renderedOn(platform, SINGLE_SOURCE_LIST);
      expect(rendered.split('Only GROWI')).toHaveLength(2);
      expect(rendered).toContain('foo');
      expect(rendered).toContain('bar');
    }
  });

  it('keeps a link whole when the page path holds characters link syntax reserves', () => {
    // GROWI joins the raw page path onto its site URL without encoding it.
    const message: OutboundMessage = {
      kind: 'list',
      title: '検索結果',
      rows: [
        {
          primary: {
            kind: 'link',
            label: 'a`b',
            url: 'https://growi.example/team/<a> b (1)|x[2]%41/a`b',
          },
          sourceLabel: 'wiki-a',
        },
      ],
    };
    const encoded =
      'https://growi.example/team/%3Ca%3E%20b%20%281%29%7Cx%5B2%5D%41/a%60b';

    expect(renderedOn('slack', message)).toContain(`<${encoded}|a\`b>`);
    for (const platform of ['discord', 'teams'] as const) {
      expect(renderedOn(platform, message)).toContain(`[a\`b](${encoded})`);
    }

    // Mattermost re-serializes the markdown before posting; the link has to
    // survive that round trip, not only the string this module writes.
    const posted = new MattermostFormatConverter().renderPostable({
      markdown: markdownOf(toPostable(message, 'mattermost', BOT_NAME)),
    });
    const urls: string[] = [];
    walkAst(parseMarkdown(posted), (node) => {
      if (isLinkNode(node)) urls.push(node.url);
      return node;
    });
    expect(urls).toEqual([encoded]);
  });

  it('renders the list as plain markdown where `card` is only degraded, with markdown links', () => {
    // Mattermost is the one service whose `card` row is `degraded`; the
    // documented fallback is 「markdown で投稿する」.
    const rendered = markdownOf(toPostable(LIST, 'mattermost', BOT_NAME));

    expect(rendered).toContain('[foo](https://growi.example/foo)');
    expect(rendered).toContain('[bar](https://growi.example/bar)');
  });

  it('keeps a markdown row as written, on every service', () => {
    for (const platform of PLATFORMS) {
      const rendered = renderedOn(platform, TEXT_LIST);
      expect(rendered).toContain('`search <word>` — searches pages');
      expect(rendered).toContain('`help` — lists commands');
      expect(rendered).toContain('wiki-a');
      expect(rendered).toContain('wiki-b');
    }
  });

  it('renders a choice as pressable buttons where interactive actions work', () => {
    for (const platform of ['slack', 'discord', 'teams'] as const) {
      const postable = toPostable(CHOICE, platform, BOT_NAME);
      expect(isCard(postable)).toBe(true);
      if (!isCard(postable)) return;

      // The correlation id must travel inside the action id via the encode/decode
      // pair, or the press is un-resumable (Implementation Note 3.3).
      expect(buttonIdsOf(postable).map(decodeActionId)).toEqual([
        { correlationId: 'corr-1', actionId: 'relation-a' },
        { correlationId: 'corr-1', actionId: 'relation-b' },
      ]);
    }
  });

  it('renders the same choice as a numbered list answered by addressing the bot, where buttons do not work', () => {
    const rendered = markdownOf(toPostable(CHOICE, 'mattermost', BOT_NAME));

    expect(rendered).toContain('どの GROWI へ送りますか?');
    expect(rendered).toContain('1. wiki-a');
    expect(rendered).toContain('2. wiki-b');
    expect(rendered).toContain(`@${BOT_NAME}`);
  });
});

describe('channelThreadId', () => {
  it('addresses the channel it was given, on every service', () => {
    // A round trip through the adapter's own projection: whatever encoding the
    // adapter uses, the thread id this builds must name the same channel.
    for (const platform of PLATFORMS) {
      const adapter = realAdapters[platform];
      const channelId = realChannelIds[platform];

      expect(
        adapter.channelIdFromThreadId(
          channelThreadId(adapter, platform, channelId, null),
        ),
      ).toBe(channelId);
    }
  });

  it('still addresses the same channel when rooted at a message', () => {
    for (const platform of PLATFORMS) {
      const adapter = realAdapters[platform];
      const channelId = realChannelIds[platform];

      expect(
        adapter.channelIdFromThreadId(
          channelThreadId(adapter, platform, channelId, 'msg-1'),
        ),
      ).toBe(channelId);
    }
  });

  it('roots the reply at the target message where the service can express it', () => {
    // Slack and Mattermost carry a thread root in their thread id; Discord and
    // Teams do not, so a rooted request there is a plain channel post.
    for (const platform of ['slack', 'mattermost'] as const) {
      const adapter = realAdapters[platform];
      const channelId = realChannelIds[platform];

      expect(channelThreadId(adapter, platform, channelId, 'msg-1')).not.toBe(
        channelThreadId(adapter, platform, channelId, null),
      );
    }
  });
});

describe('post', () => {
  it('posts to the channel it is given and hands back the reference needed to replace it', async () => {
    const adapter = adapterMock();
    adapter.postChannelMessage.mockResolvedValue({
      id: 'posted-1',
      raw: {},
      threadId: 'slack:C123:1700000000.000100',
    });

    const outcome = await post(
      contextOf(adapter),
      channelOf('slack', 'slack:C123'),
      MARKDOWN,
    );

    expect(outcome).toEqual({ ok: true, messageId: 'posted-1' });
    expect(adapter.postChannelMessage).toHaveBeenCalledWith(
      'slack:C123',
      expect.anything(),
    );
  });

  it('reports that the bot is not in the channel, with a remedy, instead of throwing', async () => {
    const notInChannel = slackPlatformError('not_in_channel');
    const adapter = adapterMock();
    adapter.postChannelMessage.mockRejectedValue(notInChannel);

    const outcome = await post(
      contextOf(adapter),
      channelOf('slack', 'slack:C123'),
      MARKDOWN,
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.reason !== 'bot-not-in-channel') {
      throw new Error(
        `expected bot-not-in-channel, got ${JSON.stringify(outcome)}`,
      );
    }
    expect(outcome.remedy).not.toBe('');
  });

  it('reports any other failure as a platform error, carrying the detail, instead of throwing', async () => {
    const adapter = adapterMock();
    adapter.postChannelMessage.mockRejectedValue(new Error('socket hang up'));

    const outcome = await post(
      contextOf(adapter),
      channelOf('slack', 'slack:C123'),
      MARKDOWN,
    );

    expect(outcome).toEqual({
      ok: false,
      reason: 'platform-error',
      detail: 'socket hang up',
    });
  });
});

describe('channelAccessFailure', () => {
  it('recognises every service own way of saying the bot is not in that channel', () => {
    const notInChannel: ReadonlyArray<unknown> = [
      slackPlatformError('channel_not_found'),
      slackPlatformError('not_in_channel'),
      // Discord: the adapter wraps a non-ok HTTP response in NetworkError. A
      // 404 means the channel is not visible to this bot at all, and 403 /
      // error code 50001 ("Missing Access") means the bot has not been added
      // to that channel either -- Discord's access model is
      // channel-membership-based, so both are fixed the same way: invite the
      // bot to the channel.
      adapterError('NetworkError', 'discord', 'Discord API error: 404 {}'),
      adapterError(
        'NetworkError',
        'discord',
        'Discord API error: 403 {"message":"Missing Access","code":50001}',
      ),
      // Mattermost answers 403 to a bot that has not joined the channel.
      adapterError(
        'PermissionError',
        'mattermost',
        'Permission denied: cannot post in mattermost',
      ),
      adapterError(
        'ResourceNotFoundError',
        'mattermost',
        "channel 'C1' not found in mattermost",
      ),
    ];

    for (const error of notInChannel) {
      expect(channelAccessFailure(error)).toBe('not-in-channel');
    }
  });

  it('tells a missing permission apart from a missing invitation', () => {
    const notPermitted: ReadonlyArray<unknown> = [
      slackPlatformError('missing_scope'),
      // Teams reads through Graph application permissions, not membership.
      adapterError(
        'PermissionError',
        'teams',
        'Permission denied: cannot fetchChannelMessages in teams',
      ),
    ];

    for (const error of notPermitted) {
      expect(channelAccessFailure(error)).toBe('not-permitted');
    }
  });

  it('says nothing about channel access for a failure that is about something else', () => {
    const others: ReadonlyArray<unknown> = [
      adapterError('AuthenticationError', 'slack', 'Token expired'),
      adapterError('AdapterRateLimitError', 'slack', 'Rate limited by slack'),
      new Error('socket hang up'),
      'a thrown string',
    ];

    for (const error of others) {
      expect(channelAccessFailure(error)).toBeNull();
    }
  });
});

describe('classifyOutboundFailure', () => {
  it('turns a missing invitation into the one outcome a reader can act on', () => {
    expect(
      classifyOutboundFailure(slackPlatformError('not_in_channel')),
    ).toEqual({
      ok: false,
      reason: 'bot-not-in-channel',
      remedy: expect.any(String),
    });
  });

  it('tells the user to invite the bot when Discord answers 403/50001 -- its access model is membership-based, unlike Teams', () => {
    // Discord's `PermissionError`-shaped 403 and its "Missing Access" (50001)
    // error both mean the bot was never added to the channel, so the fix is
    // the same as a 404: invite the bot. This is the actual end-to-end
    // outcome a caller sees, not just the intermediate `channelAccessFailure`
    // classification -- guarding against the two being changed in lockstep
    // and drifting apart again.
    const forbidden = adapterError(
      'NetworkError',
      'discord',
      'Discord API error: 403 {"message":"Forbidden"}',
    );
    const missingAccess = adapterError(
      'NetworkError',
      'discord',
      'Discord API error: 400 {"message":"Missing Access","code":50001}',
    );

    for (const error of [forbidden, missingAccess]) {
      expect(classifyOutboundFailure(error)).toEqual({
        ok: false,
        reason: 'bot-not-in-channel',
        remedy: expect.any(String),
      });
    }
  });

  it('does not tell someone to invite the bot when the fault is a missing permission', () => {
    // `PostOutcome` has one actionable arm and its remedy says "invite the
    // bot", which would be the wrong instruction here.
    expect(
      classifyOutboundFailure(slackPlatformError('missing_scope')).reason,
    ).toBe('platform-error');
  });

  it('reads a Mattermost 403 as not-a-member on an ordinary post, where nothing else can explain it', () => {
    const forbidden = adapterError(
      'PermissionError',
      'mattermost',
      'Permission denied: /channels/c1/posts',
    );

    expect(classifyOutboundFailure(forbidden)).toEqual({
      ok: false,
      reason: 'bot-not-in-channel',
      remedy: expect.any(String),
    });
  });

  it('reports a Mattermost 403 on the private message as a platform error that names the permission, not as a missing invitation', () => {
    const forbidden = adapterError(
      'PermissionError',
      'mattermost',
      'Permission denied: /posts/ephemeral',
    );

    expect(classifyOutboundFailure(forbidden, 'ephemeral')).toEqual({
      ok: false,
      reason: 'platform-error',
      detail: expect.stringMatching(
        /may lack the permission to post private messages/,
      ),
    });
  });

  it('still reads a channel that is not there as a missing invitation on the private message', () => {
    const notFound = adapterError(
      'ResourceNotFoundError',
      'mattermost',
      'resource not found',
    );

    expect(classifyOutboundFailure(notFound, 'ephemeral').reason).toBe(
      'bot-not-in-channel',
    );
  });

  it('keeps the original error text in the detail of a refused private message', () => {
    const forbidden = adapterError(
      'PermissionError',
      'mattermost',
      'Permission denied: /posts/ephemeral',
    );

    const outcome = classifyOutboundFailure(forbidden, 'ephemeral');

    expect(outcome.ok === false && outcome.reason === 'platform-error').toBe(
      true,
    );
    expect(JSON.stringify(outcome)).toContain('/posts/ephemeral');
  });

  it('leaves the permission hint off a missing scope on an ordinary post', () => {
    const outcome = classifyOutboundFailure(
      slackPlatformError('missing_scope'),
    );

    expect(outcome).toEqual({
      ok: false,
      reason: 'platform-error',
      detail: 'An API error occurred: missing_scope',
    });
  });

  it('does not mistake an authentication or rate-limit failure for a missing invitation', () => {
    const others: ReadonlyArray<unknown> = [
      adapterError('AuthenticationError', 'slack', 'Token expired'),
      adapterError('AdapterRateLimitError', 'slack', 'Rate limited by slack'),
      'a thrown string',
    ];

    for (const error of others) {
      expect(classifyOutboundFailure(error).reason).toBe('platform-error');
    }
  });
});

describe('postEphemeral', () => {
  const userOn = (platform: PlatformName): ChatAccountRef => ({
    platform,
    accountId: 'U1',
    displayName: 'Someone',
  });

  it('sends a message only that user can see, addressed at the channel it was given', async () => {
    const adapter = slackAdapter;
    const send = vi.spyOn(adapter, 'postEphemeral').mockResolvedValue({
      id: 'eph-1',
      raw: {},
      threadId: 'slack:C123:',
      usedFallback: false,
    });

    const outcome = await postEphemeral(
      contextOf(adapter),
      channelOf('slack', realChannelIds.slack),
      userOn('slack'),
      MARKDOWN,
    );

    expect(outcome).toEqual({ ok: true, messageId: 'eph-1' });
    expect(send).toHaveBeenCalledTimes(1);
    const [threadId, userId] = send.mock.calls[0] ?? [];
    expect(userId).toBe('U1');
    expect(adapter.channelIdFromThreadId(String(threadId))).toBe(
      realChannelIds.slack,
    );

    send.mockRestore();
  });

  it('hands Mattermost a thread id for the channel, not the bare channel id it cannot decode', async () => {
    const adapter = mattermostAdapter;
    const send = vi.spyOn(adapter, 'postEphemeral').mockResolvedValue({
      id: 'eph-mm',
      raw: mock<MattermostPost>(),
      threadId: 'unused',
      usedFallback: false,
    });

    const outcome = await postEphemeral(
      contextOf(adapter),
      channelOf('mattermost', realChannelIds.mattermost),
      userOn('mattermost'),
      MARKDOWN,
    );

    expect(outcome).toEqual({ ok: true, messageId: 'eph-mm' });
    const [threadId] = send.mock.calls[0] ?? [];
    expect(adapter.decodeThreadId(String(threadId))).toMatchObject({
      channelId: 'mmchan1',
    });

    send.mockRestore();
  });

  it('answers unsupported on a service with no native ephemeral, sending nothing and opening no direct message', async () => {
    const adapter = discordAdapter;
    expect('postEphemeral' in adapter).toBe(false);
    const postSpy = vi
      .spyOn(adapter, 'postMessage')
      .mockRejectedValue(new Error('must not post'));
    const openDM = vi
      .spyOn(adapter, 'openDM')
      .mockRejectedValue(new Error('must not open a DM'));

    const outcome = await postEphemeral(
      contextOf(adapter),
      channelOf('discord', realChannelIds.discord),
      userOn('discord'),
      MARKDOWN,
    );

    expect(outcome).toEqual({ ok: false, reason: 'unsupported' });
    expect(postSpy).not.toHaveBeenCalled();
    expect(openDM).not.toHaveBeenCalled();

    postSpy.mockRestore();
    openDM.mockRestore();
  });

  it('does not blame the invitation when Mattermost refuses the private message, since a 403 there is usually a missing permission', async () => {
    const adapter = mattermostAdapter;
    const send = vi
      .spyOn(adapter, 'postEphemeral')
      .mockRejectedValue(
        adapterError(
          'PermissionError',
          'mattermost',
          'Permission denied: cannot post in mattermost',
        ),
      );

    const outcome = await postEphemeral(
      contextOf(adapter),
      channelOf('mattermost', realChannelIds.mattermost),
      userOn('mattermost'),
      MARKDOWN,
    );

    expect(outcome).toEqual({
      ok: false,
      reason: 'platform-error',
      detail: expect.stringMatching(
        /may lack the permission to post private messages/,
      ),
    });

    send.mockRestore();
  });

  it('reports a failure as a PostOutcome instead of throwing', async () => {
    const adapter = adapterMock();
    adapter.postEphemeral.mockRejectedValue(new Error('boom'));

    const outcome = await postEphemeral(
      contextOf(adapter),
      channelOf('teams', realChannelIds.teams),
      userOn('teams'),
      MARKDOWN,
    );

    expect(outcome).toEqual({
      ok: false,
      reason: 'platform-error',
      detail: 'boom',
    });
  });
});

describe('postDirect', () => {
  const userOn = (platform: PlatformName): ChatAccountRef => ({
    platform,
    accountId: 'U1',
    displayName: 'Someone',
  });

  /** What each real adapter's own `openDM` answers with for a 1:1 conversation. */
  const dmThreadIds: Readonly<Record<PlatformName, string>> = {
    slack: slackAdapter.encodeThreadId({ channel: 'D0DM00001', threadTs: '' }),
    discord: discordAdapter.encodeThreadId({
      guildId: '@me',
      channelId: '700000000000000001',
    }),
    teams: realAdapters.teams.encodeThreadId({
      conversationId: 'a:1dm-conversation',
      serviceUrl: 'https://smba.example.com/',
      conversationType: 'personal',
    }),
    mattermost: mattermostAdapter.encodeThreadId({ channelId: 'mmdm00001' }),
  };

  /**
   * A mock whose addressing is the real adapter's, so the returned channel is
   * checked against the encoding the rest of the app reads events in.
   */
  const dmCapableAdapter = (platform: PlatformName) => {
    const adapter = adapterMock();
    const real = realAdapters[platform];
    adapter.channelIdFromThreadId.mockImplementation((threadId) =>
      real.channelIdFromThreadId(threadId),
    );
    adapter.openDM.mockResolvedValue(dmThreadIds[platform]);
    adapter.postMessage.mockResolvedValue({
      id: 'dm-message-1',
      raw: {},
      threadId: dmThreadIds[platform],
    });
    return adapter;
  };

  it.each(
    PLATFORMS,
  )('opens the 1:1 conversation on %s, posts there, and answers with the DM channel', async (platform) => {
    const adapter = dmCapableAdapter(platform);

    const outcome = await postDirect(
      contextOf(adapter),
      channelOf(platform, realChannelIds[platform]),
      userOn(platform),
      MARKDOWN,
    );

    expect(adapter.openDM).toHaveBeenCalledWith('U1');
    expect(adapter.postMessage).toHaveBeenCalledWith(dmThreadIds[platform], {
      markdown: 'hello **world**',
    });
    expect(outcome).toEqual({
      ok: true,
      messageId: 'dm-message-1',
      channel: {
        platform,
        channelId: toSdkChannelId(
          platform,
          realAdapters[platform].channelIdFromThreadId(dmThreadIds[platform]),
        ),
        channelName: '',
        isPrivate: true,
      },
    });
  });

  it('opens the conversation and posts inside the installation it was scoped to', async () => {
    const adapter = dmCapableAdapter('slack');
    let bound = false;
    const seenBound: boolean[] = [];
    adapter.openDM.mockImplementation(() => {
      seenBound.push(bound);
      return Promise.resolve(dmThreadIds.slack);
    });
    adapter.postMessage.mockImplementation(() => {
      seenBound.push(bound);
      return Promise.resolve({
        id: 'dm-message-1',
        raw: {},
        threadId: dmThreadIds.slack,
      });
    });
    const run = async <T>(work: () => Promise<T>): Promise<T> => {
      bound = true;
      try {
        return await work();
      } finally {
        bound = false;
      }
    };

    const outcome = await postDirect(
      { ...contextOf(adapter), run },
      channelOf('slack', realChannelIds.slack),
      userOn('slack'),
      MARKDOWN,
    );

    expect(outcome.ok).toBe(true);
    expect(seenBound).toEqual([true, true]);
  });

  it('answers why when the conversation cannot be opened, posting nothing and not throwing', async () => {
    const adapter = dmCapableAdapter('slack');
    adapter.openDM.mockRejectedValue(slackPlatformError('missing_scope'));

    const outcome = await postDirect(
      contextOf(adapter),
      channelOf('slack', realChannelIds.slack),
      userOn('slack'),
      MARKDOWN,
    );

    expect(outcome).toEqual({
      ok: false,
      detail: expect.stringContaining('missing_scope'),
    });
    expect(adapter.postMessage).not.toHaveBeenCalled();
  });

  it('answers why when the post into the opened conversation fails', async () => {
    const adapter = dmCapableAdapter('teams');
    adapter.postMessage.mockRejectedValue(new Error('blocked by the user'));

    const outcome = await postDirect(
      contextOf(adapter),
      channelOf('teams', realChannelIds.teams),
      userOn('teams'),
      MARKDOWN,
    );

    expect(outcome).toEqual({ ok: false, detail: 'blocked by the user' });
  });

  it('answers a failure on an adapter that cannot open a direct message', async () => {
    const adapter: Adapter = { ...dmCapableAdapter('slack') };
    delete (adapter as { openDM?: unknown }).openDM;

    const outcome = await postDirect(
      contextOf(adapter),
      channelOf('slack', realChannelIds.slack),
      userOn('slack'),
      MARKDOWN,
    );

    expect(outcome).toEqual({ ok: false, detail: expect.any(String) });
  });

  it('posts nothing when the opened conversation is not a channel id this proxy can read', async () => {
    const adapter = dmCapableAdapter('slack');
    adapter.channelIdFromThreadId.mockReturnValue('not-a-slack-channel');

    const outcome = await postDirect(
      contextOf(adapter),
      channelOf('slack', realChannelIds.slack),
      userOn('slack'),
      MARKDOWN,
    );

    expect(outcome).toEqual({ ok: false, detail: expect.any(String) });
    expect(adapter.postMessage).not.toHaveBeenCalled();
  });
});

describe('addReaction', () => {
  const messageOn = (platform: PlatformName): SdkMessageRef => ({
    channel: channelOf(platform, realChannelIds[platform]),
    messageId: 'M1',
  });

  it.each(
    PLATFORMS,
  )('reacts to the message on %s, addressed at its channel', async (platform) => {
    const adapter = adapterMock();
    const real = realAdapters[platform];
    adapter.channelIdFromThreadId.mockImplementation((threadId) =>
      real.channelIdFromThreadId(threadId),
    );
    adapter.encodeThreadId.mockImplementation((data) =>
      real.encodeThreadId(data),
    );
    adapter.decodeThreadId.mockImplementation((threadId) =>
      real.decodeThreadId(threadId),
    );
    adapter.addReaction.mockResolvedValue(undefined);

    const outcome = await addReaction(
      contextOf(adapter),
      messageOn(platform),
      'eyes',
    );

    expect(outcome).toEqual({ ok: true });
    const [threadId, messageId] = adapter.addReaction.mock.calls[0] ?? [];
    expect(messageId).toBe('M1');
    expect(real.channelIdFromThreadId(String(threadId))).toBe(
      realChannelIds[platform],
    );
  });

  it.each([
    ['eyes', 'eyes'],
    ['email', 'email'],
  ] as const)('hands Slack the %s reaction by its Slack name', async (reaction, slackName) => {
    const reactionsAdd = vi
      .spyOn(slackAdapter, 'addReaction')
      .mockResolvedValue(undefined);

    await addReaction(contextOf(slackAdapter), messageOn('slack'), reaction);

    const [, , emoji] = reactionsAdd.mock.calls[0] ?? [];
    expect(String(emoji)).toContain(slackName);

    reactionsAdd.mockRestore();
  });

  it('treats a reaction that is already there as success', async () => {
    const adapter = adapterMock();
    adapter.addReaction.mockRejectedValue(
      slackPlatformError('already_reacted'),
    );

    const outcome = await addReaction(
      contextOf(adapter),
      messageOn('discord'),
      'email',
    );

    expect(outcome).toEqual({ ok: true });
  });

  it('answers why any other failure happened, instead of throwing', async () => {
    const adapter = adapterMock();
    adapter.addReaction.mockRejectedValue(
      slackPlatformError('message_not_found'),
    );

    const outcome = await addReaction(
      contextOf(adapter),
      messageOn('discord'),
      'email',
    );

    expect(outcome).toEqual({
      ok: false,
      detail: expect.stringContaining('message_not_found'),
    });
  });
});

describe('replace', () => {
  it('edits the existing message in place rather than posting a second one', async () => {
    const adapter = realAdapters.slack;
    const edit = vi
      .spyOn(adapter, 'editMessage')
      .mockResolvedValue({ id: 'posted-1', raw: {}, threadId: 'slack:C123:' });
    // `postMessage` is the only posting entry point declared as required on
    // `Adapter`; combined with a single `editMessage` call it is enough to show
    // the message was edited rather than re-posted.
    const postSpy = vi.spyOn(adapter, 'postMessage');

    const target: SdkMessageRef = {
      channel: channelOf('slack', realChannelIds.slack),
      messageId: 'posted-1',
    };
    const outcome = await replace(contextOf(adapter), target, MARKDOWN);

    expect(outcome).toEqual({ ok: true, messageId: 'posted-1' });
    expect(postSpy).not.toHaveBeenCalled();
    expect(edit).toHaveBeenCalledTimes(1);
    const [threadId, messageId] = edit.mock.calls[0] ?? [];
    expect(messageId).toBe('posted-1');
    expect(adapter.channelIdFromThreadId(String(threadId))).toBe(
      realChannelIds.slack,
    );

    edit.mockRestore();
    postSpy.mockRestore();
  });

  it('reports a failure as a PostOutcome instead of throwing', async () => {
    const adapter = adapterMock();
    adapter.editMessage.mockRejectedValue(new Error('message_not_found'));

    const outcome = await replace(
      contextOf(adapter),
      { channel: channelOf('discord', 'discord:G1:C1'), messageId: 'm1' },
      MARKDOWN,
    );

    expect(outcome).toEqual({
      ok: false,
      reason: 'platform-error',
      detail: 'message_not_found',
    });
  });
});

describe('attachPreview', () => {
  it('posts the preview alongside the message it describes, not as an unrelated channel post', async () => {
    const adapter = realAdapters.slack;
    const postMessage = vi.spyOn(adapter, 'postMessage').mockResolvedValue({
      id: 'preview-1',
      raw: {},
      threadId: 'slack:C123:ts',
    });

    const target: SdkMessageRef = {
      channel: channelOf('slack', realChannelIds.slack),
      messageId: '1700000000.000100',
    };
    const outcome = await attachPreview(contextOf(adapter), target, MARKDOWN);

    expect(outcome).toEqual({ ok: true, messageId: 'preview-1' });
    const [threadId] = postMessage.mock.calls[0] ?? [];
    expect(threadId).toBe(
      channelThreadId(adapter, 'slack', realChannelIds.slack, target.messageId),
    );
    expect(threadId).not.toBe(
      channelThreadId(adapter, 'slack', realChannelIds.slack, null),
    );

    postMessage.mockRestore();
  });

  it('reports a failure as a PostOutcome instead of throwing', async () => {
    const adapter = realAdapters.slack;
    const postMessage = vi.spyOn(adapter, 'postMessage');
    postMessage.mockRejectedValue(new Error('nope'));

    const outcome = await attachPreview(
      contextOf(adapter),
      { channel: channelOf('slack', realChannelIds.slack), messageId: 'm1' },
      MARKDOWN,
    );

    expect(outcome).toEqual({
      ok: false,
      reason: 'platform-error',
      detail: 'nope',
    });

    postMessage.mockRestore();
  });
});
