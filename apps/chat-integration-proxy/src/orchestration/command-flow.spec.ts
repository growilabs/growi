import {
  COMMAND_NAMES,
  type CommandRequest,
  type CommandResponse,
  OP_NAMES,
  type PlatformName,
} from '@growi/chat';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type MockProxy, mock } from 'vitest-mock-extended';

import {
  type ArgumentCollector,
  LINK_COMMAND_WORD,
  SEARCH_DEFAULT_LIMIT,
} from '../command/index.js';
import { createFanOutCollector, type GrowiClient } from '../growi/index.js';
import type { GrowiSelector, SelectionRequest } from '../relation/index.js';
import type { Invocation, OutboundMessage, Relation } from '../types/index.js';
import type { AdminFlow } from './admin-flow.js';
import {
  type CommandFlowDeps,
  type CommandFlowPlatform,
  createCommandFlow,
} from './command-flow.js';
import type { LinkPostedEvent } from './event-sink.js';

const PLATFORM: PlatformName = 'slack';
const INSTALLATION_ID = 'inst-1';

const channel = {
  platform: PLATFORM,
  channelId: 'C1',
  channelName: 'general',
  isPrivate: false,
};
const actor = { platform: PLATFORM, accountId: 'U1', displayName: 'Taro' };

const relationOf = (
  relationId: string,
  growiLabel: string,
  searchWeight = 1,
): Relation => ({
  relationId,
  installationId: INSTALLATION_ID,
  growiUri: `https://${relationId}.example.com/`,
  growiLabel,
  searchWeight,
  settingsVersion: 1,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
});

const GROWI_A = relationOf('rel-a', 'GROWI A');
const GROWI_B = relationOf('rel-b', 'GROWI B');

const invocationOf = (commandName: string, argsText = ''): Invocation => ({
  platform: PLATFORM,
  channel,
  actor,
  commandName,
  argsText,
  interaction: null,
});

interface Harness {
  readonly flow: ReturnType<typeof createCommandFlow>;
  readonly platform: CommandFlowPlatform;
  readonly selector: GrowiSelector;
  readonly collector: CommandFlowDeps['collector'];
  readonly growiClient: GrowiClient;
  readonly resolveInstallationId: CommandFlowDeps['resolveInstallationId'];
  readonly adminFlow: MockProxy<AdminFlow>;
  readonly ephemeralMessages: () => ReadonlyArray<OutboundMessage>;
  readonly postedMessages: () => ReadonlyArray<OutboundMessage>;
}

const createHarness = (): Harness => {
  const platform = mock<CommandFlowPlatform>();
  vi.mocked(platform.post).mockResolvedValue({ ok: true, messageId: 'M100' });
  vi.mocked(platform.postEphemeral).mockResolvedValue({
    ok: true,
    messageId: 'M101',
  });
  vi.mocked(platform.replace).mockResolvedValue({
    ok: true,
    messageId: 'M100',
  });
  vi.mocked(platform.attachPreview).mockResolvedValue({
    ok: true,
    messageId: 'M102',
  });

  const selector = mock<GrowiSelector>();
  const collector =
    mock<Pick<ArgumentCollector, 'start' | 'startGrowiChoice'>>();
  vi.mocked(collector.start).mockResolvedValue({
    status: 'collected',
    values: {},
  });
  vi.mocked(collector.startGrowiChoice).mockResolvedValue({
    status: 'pending',
    correlationId: 'corr-1',
  });

  const growiClient = mock<GrowiClient>();

  const resolveInstallationId = vi.fn(() => Promise.resolve(INSTALLATION_ID));

  // Operator words are executed by their own flow (`admin-flow.ts`); this one
  // only routes to it.
  const adminFlow = mock<AdminFlow>();
  adminFlow.run.mockResolvedValue();

  const flow = createCommandFlow({
    platform,
    selector,
    collector,
    growiClient,
    // The real fan-out over a mocked client: the request each target is sent
    // and the answer each one gives are what these tests are about.
    fanOutCollector: createFanOutCollector({ growiClient }),
    resolveInstallationId,
    adminFlow,
    newRequestId: (() => {
      // Requirement 10.4 keys duplicate-execution detection on this value, so
      // the fixture has to make two targets' ids actually differ.
      let issued = 0;
      return () => {
        issued = issued + 1;
        return `req-${issued}`;
      };
    })(),
  });

  return {
    flow,
    platform,
    selector,
    collector,
    growiClient,
    resolveInstallationId,
    adminFlow,
    ephemeralMessages: () =>
      vi.mocked(platform.postEphemeral).mock.calls.map((call) => call[2]),
    postedMessages: () =>
      vi.mocked(platform.post).mock.calls.map((call) => call[1]),
  };
};

const searchResponse = (title: string): CommandResponse => ({
  kind: 'search',
  appliedAs: 'linked-user',
  items: [
    {
      rank: 1,
      path: `/${title}`,
      title,
      url: `https://example.com/${title}`,
      updatedAt: '2026-09-01T00:00:00.000Z',
      commentCount: 0,
    },
  ],
});

describe('the five commands, end to end', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  it('search: asks every permitted GROWI, then replaces the placeholder with one merged list', async () => {
    vi.mocked(harness.selector.select).mockResolvedValue({
      kind: 'execute',
      targets: [GROWI_A, GROWI_B],
      excluded: [
        { relationId: 'rel-c', growiLabel: 'GROWI C', reason: 'no-settings' },
      ],
    });
    vi.mocked(harness.collector.start).mockResolvedValue({
      status: 'collected',
      values: { keyword: 'onboarding' },
    });
    vi.mocked(harness.growiClient.sendCommand).mockImplementation((uri) =>
      Promise.resolve({
        ok: true,
        response: searchResponse(uri.includes('rel-a') ? 'Alpha' : 'Beta'),
      }),
    );

    await harness.flow.startCommand(invocationOf(COMMAND_NAMES.search));

    // Posted first, replaced once the answers are in: a `MessageRef` does not
    // exist before the first post.
    expect(harness.platform.post).toHaveBeenCalledTimes(1);
    const [replaced, message] =
      vi.mocked(harness.platform.replace).mock.calls[0] ?? [];
    expect(replaced).toEqual({ channel, messageId: 'M100' });
    expect(message).toMatchObject({ kind: 'list' });
    if (message?.kind !== 'list') throw new Error('expected a list');
    expect(message.rows.map((row) => row.sourceLabel)).toEqual([
      'GROWI A',
      'GROWI B',
    ]);
    expect(message.rows[0]?.markdown).toContain('https://example.com/Alpha');
    // Requirement 11.3: a GROWI left out by channel permission is named, so
    // the search does not go quietly incomplete.
    expect(message.footer).toContain('GROWI C');

    const sent = vi
      .mocked(harness.growiClient.sendCommand)
      .mock.calls.map((call) => call[1]);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      kind: COMMAND_NAMES.search,
      keyword: 'onboarding',
      limit: SEARCH_DEFAULT_LIMIT,
      relationId: GROWI_A.relationId,
      op: OP_NAMES.command,
      actor,
      channel,
    });
    // Requirement 10.4: duplicate-execution detection is keyed on this, so
    // two targets must not share one id.
    expect(sent[0]?.requestId).not.toBe(sent[1]?.requestId);
  });

  it('search: says so, and names who was silent, when nothing came back at all', async () => {
    vi.mocked(harness.selector.select).mockResolvedValue({
      kind: 'execute',
      targets: [GROWI_A],
      excluded: [],
    });
    vi.mocked(harness.collector.start).mockResolvedValue({
      status: 'collected',
      values: { keyword: 'onboarding' },
    });
    vi.mocked(harness.growiClient.sendCommand).mockResolvedValue({
      ok: false,
      reason: 'unreachable',
    });

    await harness.flow.startCommand(invocationOf(COMMAND_NAMES.search));

    const [, message] = vi.mocked(harness.platform.replace).mock.calls[0] ?? [];
    expect(message?.kind).toBe('markdown');
    if (message?.kind !== 'markdown') throw new Error('expected markdown');
    expect(message.markdown).toContain('GROWI A');
    // A GROWI that answered with a failure is reported as an error, not as a
    // deadline that ran out: the two tell the reader different things about
    // whether retrying is worth it.
    expect(message.markdown).toContain('エラー');
    expect(message.markdown).not.toContain('時間切れ');
  });

  it('search: keeps the two reasons a GROWI was left out apart, each under its own wording', async () => {
    // Requirement 11.3 / design.md 「`not-permitted-in-channel` と
    // `no-settings` は利用者への案内が違うので、1 つに丸めない」. The two ask
    // the reader to do different things (get the channel allowed vs. get the
    // permissions set at all), so each line must name ITS OWN GROWIs and no
    // others -- merely mentioning both names somewhere would still read as one
    // undifferentiated "left out" list.
    vi.mocked(harness.selector.select).mockResolvedValue({
      kind: 'execute',
      targets: [GROWI_A],
      excluded: [
        {
          relationId: 'rel-c',
          growiLabel: 'GROWI C',
          reason: 'not-permitted-in-channel',
        },
        { relationId: 'rel-d', growiLabel: 'GROWI D', reason: 'no-settings' },
      ],
    });
    vi.mocked(harness.collector.start).mockResolvedValue({
      status: 'collected',
      values: { keyword: 'onboarding' },
    });
    vi.mocked(harness.growiClient.sendCommand).mockResolvedValue({
      ok: true,
      response: searchResponse('Alpha'),
    });

    await harness.flow.startCommand(invocationOf(COMMAND_NAMES.search));

    const [, message] = vi.mocked(harness.platform.replace).mock.calls[0] ?? [];
    if (message?.kind !== 'list') throw new Error('expected a list');
    const lines = (message.footer ?? '').split('\n');
    const barredLine = lines.find((line) => line.includes('許可されていない'));
    const unconfiguredLine = lines.find((line) =>
      line.includes('設定されていない'),
    );

    // Both wordings are present, and they are DIFFERENT lines: collapsing the
    // two reasons into one sentence leaves one of these undefined.
    expect(barredLine).toBeDefined();
    expect(unconfiguredLine).toBeDefined();
    expect(barredLine).not.toBe(unconfiguredLine);
    // And each names only the GROWIs it is actually about, in both directions.
    expect(barredLine).toContain('GROWI C');
    expect(barredLine).not.toContain('GROWI D');
    expect(unconfiguredLine).toContain('GROWI D');
    expect(unconfiguredLine).not.toContain('GROWI C');
  });

  it('search: shows the answer to the asker when the placeholder itself could not be posted', async () => {
    // The placeholder is what the answer would have replaced, so when it never
    // went out there is no message to replace. The answer is shown to the
    // person who asked instead of being dropped -- doing the work and then
    // throwing the result away is the one outcome this branch exists to rule
    // out.
    vi.mocked(harness.platform.post).mockResolvedValue({
      ok: false,
      reason: 'bot-not-in-channel',
      remedy: 'invite the bot to this channel',
    });
    vi.mocked(harness.selector.select).mockResolvedValue({
      kind: 'execute',
      targets: [GROWI_A],
      excluded: [],
    });
    vi.mocked(harness.collector.start).mockResolvedValue({
      status: 'collected',
      values: { keyword: 'onboarding' },
    });
    vi.mocked(harness.growiClient.sendCommand).mockResolvedValue({
      ok: true,
      response: searchResponse('Alpha'),
    });

    await harness.flow.startCommand(invocationOf(COMMAND_NAMES.search));

    // Nothing to replace: there is no `MessageRef` for a post that failed.
    expect(harness.platform.replace).not.toHaveBeenCalled();
    // The merged answer itself reached the asker -- not merely "some message".
    const shown = harness.ephemeralMessages().at(-1);
    if (shown?.kind !== 'list') throw new Error('expected the merged list');
    expect(shown.rows[0]?.sourceLabel).toBe('GROWI A');
    expect(shown.rows[0]?.markdown).toContain('https://example.com/Alpha');
  });

  it('help: leaves out a command this channel is not allowed to run', async () => {
    vi.mocked(harness.selector.select).mockImplementation(
      (request: SelectionRequest) => {
        if (request.targeting === 'all-paired-no-filter') {
          throw new Error('unexpected');
        }
        // `create-page` is barred here; `help` and `search` are not.
        return Promise.resolve(
          request.commandName === COMMAND_NAMES.createPage
            ? {
                kind: 'explain',
                reason: 'not-permitted',
                excluded: [
                  {
                    relationId: GROWI_A.relationId,
                    growiLabel: GROWI_A.growiLabel,
                    reason: 'not-permitted-in-channel',
                  },
                ],
              }
            : { kind: 'execute', targets: [GROWI_A], excluded: [] },
        );
      },
    );
    vi.mocked(harness.growiClient.sendCommand).mockResolvedValue({
      ok: true,
      response: {
        kind: 'help',
        commands: [
          {
            name: COMMAND_NAMES.search,
            usage: 'search <word>',
            description: 'searches',
          },
          {
            name: COMMAND_NAMES.createPage,
            usage: 'create-page',
            description: 'creates a page',
          },
        ],
      },
    });

    await harness.flow.startCommand(invocationOf(COMMAND_NAMES.help));

    const [, message] = vi.mocked(harness.platform.replace).mock.calls[0] ?? [];
    if (message?.kind !== 'list') throw new Error('expected a list');
    const text = message.rows.map((row) => row.markdown).join('\n');
    expect(text).toContain('search <word>');
    expect(text).not.toContain('create-page');
    // Requirement 14.3: which GROWI each line came from.
    expect(message.rows.every((row) => row.sourceLabel === 'GROWI A')).toBe(
      true,
    );
    // The installation is looked up once for the whole invocation: the
    // selection carries it on to the steps that follow.
    expect(harness.resolveInstallationId).toHaveBeenCalledTimes(1);
  });

  it('create-page: sends to the single permitted GROWI and posts the new page', async () => {
    vi.mocked(harness.selector.select).mockResolvedValue({
      kind: 'execute',
      targets: [GROWI_A],
      excluded: [],
    });
    vi.mocked(harness.collector.start).mockResolvedValue({
      status: 'collected',
      values: { path: '/memo/today', body: 'hello' },
    });
    vi.mocked(harness.growiClient.sendCommand).mockResolvedValue({
      ok: true,
      response: { kind: 'created', pageUrl: 'https://rel-a.example.com/memo' },
    });

    await harness.flow.startCommand(invocationOf(COMMAND_NAMES.createPage));

    expect(
      vi.mocked(harness.growiClient.sendCommand).mock.calls[0]?.[1],
    ).toMatchObject({
      kind: COMMAND_NAMES.createPage,
      path: '/memo/today',
      body: 'hello',
      relationId: GROWI_A.relationId,
    });
    expect(harness.postedMessages()[0]).toEqual({
      kind: 'markdown',
      markdown: expect.stringContaining('https://rel-a.example.com/memo'),
    });
  });

  it('keep: never reaches GROWI when the chosen range holds no messages', async () => {
    vi.mocked(harness.selector.select).mockResolvedValue({
      kind: 'execute',
      targets: [GROWI_A],
      excluded: [],
    });
    vi.mocked(harness.collector.start).mockResolvedValue({
      status: 'collected',
      values: { range: '2026-09-01..2026-09-02', path: '/memo/log' },
    });
    vi.mocked(harness.platform.fetchHistory).mockResolvedValue({
      ok: true,
      messages: [],
    });

    await harness.flow.startCommand(invocationOf(COMMAND_NAMES.keep));

    expect(harness.growiClient.sendCommand).not.toHaveBeenCalled();
    expect(harness.ephemeralMessages()).toHaveLength(1);
  });

  it('keep: turns the fetched conversation into the messages GROWI stores', async () => {
    vi.mocked(harness.selector.select).mockResolvedValue({
      kind: 'execute',
      targets: [GROWI_A],
      excluded: [],
    });
    vi.mocked(harness.collector.start).mockResolvedValue({
      status: 'collected',
      values: { range: '2026-09-01..2026-09-02', path: '/memo/log' },
    });
    vi.mocked(harness.platform.fetchHistory).mockResolvedValue({
      ok: true,
      messages: [
        { postedAt: '2026-09-01T01:00:00.000Z', author: actor, text: 'hi' },
      ],
    });
    vi.mocked(harness.growiClient.sendCommand).mockResolvedValue({
      ok: true,
      response: { kind: 'created', pageUrl: 'https://rel-a.example.com/log' },
    });

    await harness.flow.startCommand(invocationOf(COMMAND_NAMES.keep));

    const [, range] =
      vi.mocked(harness.platform.fetchHistory).mock.calls[0] ?? [];
    expect(range).toEqual({
      since: new Date('2026-09-01T00:00:00.000Z'),
      until: new Date('2026-09-02T00:00:00.000Z'),
    });
    const request = vi.mocked(harness.growiClient.sendCommand).mock
      .calls[0]?.[1] as CommandRequest;
    expect(request).toMatchObject({
      kind: COMMAND_NAMES.keep,
      path: '/memo/log',
      messages: [
        {
          postedAt: '2026-09-01T01:00:00.000Z',
          author: actor,
          markdown: 'hi',
        },
      ],
    });
  });

  it('keep: refuses a range it cannot read whole, instead of importing the wrong days', async () => {
    vi.mocked(harness.selector.select).mockResolvedValue({
      kind: 'execute',
      targets: [GROWI_A],
      excluded: [],
    });
    vi.mocked(harness.collector.start).mockResolvedValue({
      status: 'collected',
      values: { range: '2026-09-01', path: '/memo/log' },
    });
    vi.mocked(harness.platform.fetchHistory).mockResolvedValue({
      ok: true,
      messages: [
        { postedAt: '2026-09-01T01:00:00.000Z', author: actor, text: 'hi' },
      ],
    });
    vi.mocked(harness.growiClient.sendCommand).mockResolvedValue({
      ok: true,
      response: { kind: 'created', pageUrl: 'https://rel-a.example.com/log' },
    });

    // '2026-09-01' alone IS a whole day, so this one is accepted -- what the
    // rule refuses is a range the positional parse could not read whole.
    await harness.flow.startCommand(invocationOf(COMMAND_NAMES.keep));

    vi.mocked(harness.collector.start).mockResolvedValue({
      status: 'collected',
      values: { range: 'last-week', path: '/memo/log' },
    });
    await harness.flow.startCommand(invocationOf(COMMAND_NAMES.keep));

    const refusal = harness.ephemeralMessages().at(-1);
    if (refusal?.kind !== 'markdown') throw new Error('expected markdown');
    expect(refusal.markdown).toContain('..');
    expect(harness.growiClient.sendCommand).toHaveBeenCalledTimes(1);
  });

  it('link: offers every paired GROWI, then starts the link on the one chosen', async () => {
    vi.mocked(harness.selector.select).mockResolvedValue({
      kind: 'choose',
      options: [GROWI_A, GROWI_B],
      excluded: [],
    });
    vi.mocked(harness.growiClient.startAccountLink).mockResolvedValue({
      ok: true,
      response: {
        status: 'link-issued',
        linkUrl: 'https://rel-b.example.com/link/abc',
        expiresAt: '2026-09-01T00:10:00.000Z',
      },
    });

    const invocation = invocationOf(LINK_COMMAND_WORD);
    await harness.flow.startCommand(invocation);

    expect(vi.mocked(harness.selector.select).mock.calls[0]?.[0]).toEqual({
      targeting: 'all-paired-no-filter',
      installationId: INSTALLATION_ID,
    });
    expect(harness.collector.startGrowiChoice).toHaveBeenCalledWith(
      invocation,
      {},
      [
        { relationId: GROWI_A.relationId, growiLabel: GROWI_A.growiLabel },
        { relationId: GROWI_B.relationId, growiLabel: GROWI_B.growiLabel },
      ],
    );

    await harness.flow.runChosenGrowi(invocation, {}, GROWI_B.relationId);

    expect(harness.growiClient.startAccountLink).toHaveBeenCalledWith(
      GROWI_B.growiUri,
      expect.objectContaining({
        relationId: GROWI_B.relationId,
        op: OP_NAMES.accountLinkStart,
        actor,
      }),
    );
    const notice = harness.ephemeralMessages().at(-1);
    if (notice?.kind !== 'markdown') throw new Error('expected markdown');
    expect(notice.markdown).toContain('https://rel-b.example.com/link/abc');
    expect(notice.markdown).toContain(GROWI_B.growiLabel);
    expect(harness.platform.post).not.toHaveBeenCalled();
  });
});

describe('the one path an account-link notice is posted through', () => {
  it('renders a refused write and a typed `link` identically', async () => {
    // Requirement 7.6 and design.md's 「どちらも投稿の経路は 1 本にする」. Two
    // callers rendering "the same thing" separately is exactly what drifts, so
    // the assertion is that the two messages are the SAME value -- splitting
    // the wording into two copies turns this red.
    const refused = createHarness();
    vi.mocked(refused.selector.select).mockResolvedValue({
      kind: 'execute',
      targets: [GROWI_A],
      excluded: [],
    });
    vi.mocked(refused.collector.start).mockResolvedValue({
      status: 'collected',
      values: { path: '/memo', body: 'x' },
    });
    vi.mocked(refused.growiClient.sendCommand).mockResolvedValue({
      ok: true,
      response: {
        kind: 'account-link-required',
        growiLabel: GROWI_A.growiLabel,
        linkUrl: 'https://rel-a.example.com/link/xyz',
      },
    });
    await refused.flow.startCommand(invocationOf(COMMAND_NAMES.createPage));

    const typed = createHarness();
    vi.mocked(typed.selector.select).mockResolvedValue({
      kind: 'choose',
      options: [GROWI_A],
      excluded: [],
    });
    vi.mocked(typed.growiClient.startAccountLink).mockResolvedValue({
      ok: true,
      response: {
        status: 'link-issued',
        linkUrl: 'https://rel-a.example.com/link/xyz',
        expiresAt: '2026-09-01T00:10:00.000Z',
      },
    });
    await typed.flow.runChosenGrowi(
      invocationOf(LINK_COMMAND_WORD),
      {},
      GROWI_A.relationId,
    );

    expect(refused.ephemeralMessages().at(-1)).toEqual(
      typed.ephemeralMessages().at(-1),
    );
    // And only the person who asked ever sees it: the link is one-time and
    // short-lived, so it must not land in the channel.
    expect(refused.platform.post).not.toHaveBeenCalled();
    expect(typed.platform.post).not.toHaveBeenCalled();
  });
});

describe('choosing which GROWI to act on', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  it('asks once the values are in, and does not send until an answer comes back', async () => {
    vi.mocked(harness.selector.select).mockResolvedValue({
      kind: 'choose',
      options: [GROWI_A, GROWI_B],
      excluded: [],
    });
    vi.mocked(harness.collector.start).mockResolvedValue({
      status: 'collected',
      values: { path: '/memo', body: 'x' },
    });

    await harness.flow.startCommand(invocationOf(COMMAND_NAMES.createPage));

    expect(harness.collector.startGrowiChoice).toHaveBeenCalledWith(
      expect.objectContaining({ commandName: COMMAND_NAMES.createPage }),
      { path: '/memo', body: 'x' },
      [
        { relationId: GROWI_A.relationId, growiLabel: GROWI_A.growiLabel },
        { relationId: GROWI_B.relationId, growiLabel: GROWI_B.growiLabel },
      ],
    );
    expect(harness.growiClient.sendCommand).not.toHaveBeenCalled();
  });

  it('sends nothing when the answer names a GROWI that is no longer a candidate', async () => {
    // The offered list was permission-filtered at the time it was offered, and
    // it is judged again here: a press must not reach a GROWI the channel has
    // since lost access to.
    vi.mocked(harness.selector.select).mockResolvedValue({
      kind: 'choose',
      options: [GROWI_A],
      excluded: [],
    });

    await harness.flow.runChosenGrowi(
      invocationOf(COMMAND_NAMES.createPage),
      { path: '/memo', body: 'x' },
      GROWI_B.relationId,
    );

    expect(harness.growiClient.sendCommand).not.toHaveBeenCalled();
    expect(harness.ephemeralMessages()).toHaveLength(1);
  });
});

describe('dead ends the user is told about', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  it('explains, and asks nothing, when the channel may not run the command', async () => {
    vi.mocked(harness.selector.select).mockResolvedValue({
      kind: 'explain',
      reason: 'not-permitted',
      excluded: [
        {
          relationId: GROWI_A.relationId,
          growiLabel: GROWI_A.growiLabel,
          reason: 'not-permitted-in-channel',
        },
      ],
    });

    await harness.flow.startCommand(invocationOf(COMMAND_NAMES.createPage));

    // The permission judgement runs BEFORE anything is asked of the user.
    expect(harness.collector.start).not.toHaveBeenCalled();
    const message = harness.ephemeralMessages()[0];
    if (message?.kind !== 'markdown') throw new Error('expected markdown');
    expect(message.markdown).toContain(GROWI_A.growiLabel);
  });

  it('tells the user when their half-finished input has expired', async () => {
    await harness.flow.reportExpired({
      kind: 'mention',
      platform: PLATFORM,
      channel,
      actor,
      text: '@growi /memo',
      interaction: null,
    });

    expect(harness.ephemeralMessages()).toHaveLength(1);
  });

  it('answers a word it does not know', async () => {
    await harness.flow.startCommand(invocationOf('frobnicate'));

    expect(harness.ephemeralMessages()).toHaveLength(1);
    expect(harness.selector.select).not.toHaveBeenCalled();
  });

  it('treats a typed `link-preview` as a word it does not know', async () => {
    // `link-preview` is in the shared vocabulary, but its entrance is a posted
    // URL: typed on its own it names no page. Letting it through would run it
    // as a broadcast against every permitted GROWI with nothing to preview,
    // which is why it is answered as an unknown word instead.
    // The selector is given a working answer on purpose: without one, dropping
    // the guard would merely crash, and this test would pass for the wrong
    // reason instead of showing the broadcast it exists to rule out.
    vi.mocked(harness.selector.select).mockResolvedValue({
      kind: 'execute',
      targets: [GROWI_A],
      excluded: [],
    });

    await harness.flow.startCommand(invocationOf(COMMAND_NAMES.linkPreview));

    expect(harness.selector.select).not.toHaveBeenCalled();
    expect(harness.growiClient.sendCommand).not.toHaveBeenCalled();
    expect(harness.platform.post).not.toHaveBeenCalled();
    expect(harness.ephemeralMessages()).toHaveLength(1);
  });

  it('hands an operator word to the admin flow, and does nothing else with it', async () => {
    // Operator words arrive here because `EventSink` routes every command
    // through one entrance. Which of the two flows runs them is decided here
    // and nowhere else -- and a user command must never reach the admin flow,
    // nor an operator word the GROWI selection.
    const invocation = invocationOf('rotate-key');

    await harness.flow.startCommand(invocation);

    expect(harness.adminFlow.run).toHaveBeenCalledWith(invocation);
    expect(harness.platform.postEphemeral).not.toHaveBeenCalled();
    expect(harness.platform.post).not.toHaveBeenCalled();
    expect(harness.selector.select).not.toHaveBeenCalled();
  });

  it('does not send a user command to the admin flow', async () => {
    vi.mocked(harness.selector.select).mockResolvedValue({
      kind: 'explain',
      reason: 'not-linked',
      excluded: [],
    });

    await harness.flow.startCommand(invocationOf(COMMAND_NAMES.search, 'foo'));

    expect(harness.adminFlow.run).not.toHaveBeenCalled();
  });
});

describe('previewLinks', () => {
  let harness: Harness;

  const linkEvent: LinkPostedEvent = {
    kind: 'link-posted',
    platform: PLATFORM,
    channel,
    actor,
    messageRef: { channel, messageId: 'M9' },
    urls: ['https://rel-a.example.com/Sandbox'],
  };

  beforeEach(() => {
    harness = createHarness();
  });

  it('attaches a summary next to the message that carried the link', async () => {
    vi.mocked(harness.selector.select).mockResolvedValue({
      kind: 'execute',
      targets: [GROWI_A],
      excluded: [],
    });
    vi.mocked(harness.growiClient.sendCommand).mockResolvedValue({
      ok: true,
      response: {
        kind: 'link-preview',
        path: '/Sandbox',
        restricted: false,
        excerpt: 'a sandbox page',
      },
    });

    await harness.flow.previewLinks(linkEvent);

    const [target, preview] =
      vi.mocked(harness.platform.attachPreview).mock.calls[0] ?? [];
    expect(target).toEqual(linkEvent.messageRef);
    if (preview?.kind !== 'markdown') throw new Error('expected markdown');
    expect(preview.markdown).toContain('/Sandbox');
  });

  it('summarises the same link once, however often the message repeats it', async () => {
    vi.mocked(harness.selector.select).mockResolvedValue({
      kind: 'execute',
      targets: [GROWI_A],
      excluded: [],
    });
    vi.mocked(harness.growiClient.sendCommand).mockResolvedValue({
      ok: true,
      response: { kind: 'link-preview', path: '/Sandbox', restricted: true },
    });

    await harness.flow.previewLinks({
      ...linkEvent,
      urls: [
        'https://rel-a.example.com/Sandbox',
        'https://rel-a.example.com/Sandbox',
      ],
    });

    expect(harness.platform.attachPreview).toHaveBeenCalledTimes(1);
  });

  it('says nothing at all about a link belonging to no linked GROWI', async () => {
    vi.mocked(harness.selector.select).mockResolvedValue({ kind: 'silent' });

    await harness.flow.previewLinks(linkEvent);

    expect(harness.platform.attachPreview).not.toHaveBeenCalled();
    expect(harness.platform.post).not.toHaveBeenCalled();
    expect(harness.platform.postEphemeral).not.toHaveBeenCalled();
  });
});
