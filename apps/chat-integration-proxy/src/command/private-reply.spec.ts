import type { ChatAccountRef, PlatformName } from '@growi/chat';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type MockProxy, mock } from 'vitest-mock-extended';

import { testSdkChannel } from '../capabilities/test-channels.js';
import type {
  DirectPostOutcome,
  EphemeralPostOutcome,
  OutboundMessage,
  SdkChannelRef,
} from '../types/index.js';
import {
  createPrivateReplier,
  type PrivateReplierDeps,
  type PrivateReplyOrigin,
  privateReplyOriginOf,
  type UndeliverableFact,
} from './private-reply.js';

type Platform = PrivateReplierDeps['platform'];

const SECRET = 'SECRET-PAGE-TITLE';

const REPLIES: ReadonlyArray<OutboundMessage> = [
  { kind: 'markdown', markdown: `found ${SECRET}` },
  {
    kind: 'list',
    title: '検索結果',
    rows: [{ markdown: `[${SECRET}](https://wiki/p)`, sourceLabel: 'wiki' }],
    footer: `note ${SECRET}`,
  },
  {
    kind: 'choice',
    prompt: `pick ${SECRET}`,
    correlationId: 'corr-1',
    options: [{ id: 'a', label: `option ${SECRET}` }],
  },
];

const DM_CHANNEL: SdkChannelRef = testSdkChannel('slack', {
  channelName: 'dm',
  isPrivate: true,
});

const actor: ChatAccountRef = {
  platform: 'slack',
  accountId: 'U1',
  displayName: 'Alice',
};

const originOf = (
  overrides: Partial<PrivateReplyOrigin> = {},
): PrivateReplyOrigin => ({
  channel: testSdkChannel('slack'),
  actor,
  sourceMessageId: 'm-1',
  requestSummary: 'search foo',
  installationId: 'inst-1',
  ...overrides,
});

const EPHEMERAL: Readonly<Record<string, EphemeralPostOutcome>> = {
  ok: { ok: true, messageId: 'e-1' },
  'bot-not-in-channel': {
    ok: false,
    reason: 'bot-not-in-channel',
    remedy: 'REMEDY-TEXT invite the bot',
  },
  'platform-error': { ok: false, reason: 'platform-error', detail: 'HTTP 403' },
  unsupported: { ok: false, reason: 'unsupported' },
};

const EXPECTED_EPHEMERAL_FAILURE: Readonly<Record<string, string>> = {
  'bot-not-in-channel': 'bot-not-in-channel',
  'platform-error': 'platform-error: HTTP 403',
  unsupported: 'unsupported',
};

const DM: Readonly<Record<'ok' | 'fail', DirectPostOutcome>> = {
  ok: { ok: true, messageId: 'd-1', channel: DM_CHANNEL },
  fail: { ok: false, detail: 'missing_scope im:write' },
};

const DIRECT_NOTICE = 'Alice さん、返事を DM で送りました。';
const UNDELIVERABLE_NOTICE =
  'Alice さんへの返事を届けられませんでした。DM を送れませんでした。bot からの DM を受け取れる設定かを確かめ、それでも届かなければ運用者に連絡してください。';

const setup = (platform: MockProxy<Platform> = mock<Platform>()) => {
  const describePlace = vi.fn(async (_channel: SdkChannelRef) =>
    Promise.resolve<string | null>('general'),
  );
  const resolveInstallationId = vi.fn(async (_channel: SdkChannelRef) =>
    Promise.resolve<string | null>('inst-resolved'),
  );
  const reports: UndeliverableFact[] = [];
  const reportUndeliverable = vi.fn((fact: UndeliverableFact) => {
    reports.push(fact);
  });
  const replier = createPrivateReplier({
    platform,
    describePlace,
    resolveInstallationId,
    reportUndeliverable,
  });
  return { platform, replier, describePlace, resolveInstallationId, reports };
};

/** Every argument any platform call received, flattened to one string. */
const allPostedText = (platform: MockProxy<Platform>): string =>
  JSON.stringify(platform.post.mock.calls);

const scopesOf = (platform: MockProxy<Platform>): unknown[] => [
  ...platform.post.mock.calls.map((call) => call[2]),
  ...platform.postEphemeral.mock.calls.map((call) => call[3]),
  ...platform.postDirect.mock.calls.map((call) => call[3]),
  ...platform.addReaction.mock.calls.map((call) => call[2]),
];

describe('PrivateReplier.reply -- every failure combination', () => {
  const ephemeralCases = Object.keys(EPHEMERAL);
  const matrix = ephemeralCases.flatMap((ephemeral) =>
    (['ok', 'fail'] as const).flatMap((dm) =>
      (['ok', 'fail'] as const).flatMap((notice) =>
        [true, false].flatMap((hasMessage) =>
          REPLIES.map((message) => ({
            ephemeral,
            dm,
            notice,
            hasMessage,
            message,
          })),
        ),
      ),
    ),
  );

  it.each(
    matrix,
  )('ephemeral=$ephemeral dm=$dm notice=$notice message=$hasMessage kind=$message.kind', async ({
    ephemeral,
    dm,
    notice,
    hasMessage,
    message,
  }) => {
    const { platform, replier, reports } = setup();
    platform.postEphemeral.mockResolvedValue(EPHEMERAL[ephemeral]);
    platform.postDirect.mockResolvedValue(DM[dm]);
    platform.addReaction.mockResolvedValue(
      notice === 'ok' ? { ok: true } : { ok: false, detail: 'invalid_name' },
    );
    platform.post.mockResolvedValue(
      notice === 'ok'
        ? { ok: true, messageId: 'n-1' }
        : { ok: false, reason: 'platform-error', detail: 'not_in_channel' },
    );
    const origin = originOf({ sourceMessageId: hasMessage ? 'm-1' : null });

    const outcome = await replier.reply(origin, message);

    // Requirement 1.6 / 3.13: nothing public ever carries the reply.
    expect(allPostedText(platform)).not.toContain(SECRET);
    for (const [, posted] of platform.post.mock.calls) {
      expect([DIRECT_NOTICE, UNDELIVERABLE_NOTICE]).toContain(
        posted.kind === 'markdown' ? posted.markdown : posted,
      );
    }
    // The same installation on every call that was made.
    expect(new Set(scopesOf(platform).map((s) => JSON.stringify(s)))).toEqual(
      new Set([JSON.stringify({ installationId: 'inst-1' })]),
    );

    if (ephemeral === 'ok') {
      // Requirement 1.7
      expect(outcome).toEqual({ kind: 'in-place' });
      expect(platform.postEphemeral).toHaveBeenCalledWith(
        origin.channel,
        actor,
        message,
        { installationId: 'inst-1' },
      );
      expect(platform.postDirect).not.toHaveBeenCalled();
      expect(platform.post).not.toHaveBeenCalled();
      expect(platform.addReaction).not.toHaveBeenCalled();
      expect(reports).toEqual([]);
      return;
    }

    // Requirement 1.8 / 1.9: any failure, whatever its reason, falls back to a DM.
    expect(platform.postDirect).toHaveBeenCalledTimes(1);
    const [near, user, directBody] = platform.postDirect.mock.calls[0];
    expect(near).toEqual(origin.channel);
    expect(user).toEqual(actor);
    expectHeaderedBody(directBody, message, 'general', 'search foo');

    if (dm === 'ok') {
      expect(outcome).toEqual({ kind: 'direct', directChannel: DM_CHANNEL });
      expect(reports).toEqual([]);
      // Requirement 1.10
      if (hasMessage) {
        expect(platform.addReaction).toHaveBeenCalledWith(
          { channel: origin.channel, messageId: 'm-1' },
          'email',
          { installationId: 'inst-1' },
        );
      } else {
        expect(platform.addReaction).not.toHaveBeenCalled();
      }
      const reactionLanded = hasMessage && notice === 'ok';
      expect(platform.post).toHaveBeenCalledTimes(reactionLanded ? 0 : 1);
      if (!reactionLanded) {
        expect(platform.post).toHaveBeenCalledWith(
          origin.channel,
          { kind: 'markdown', markdown: DIRECT_NOTICE },
          { installationId: 'inst-1' },
        );
      }
      return;
    }

    // Requirement 1.11 / 1.12: neither route worked.
    expect(outcome).toEqual({ kind: 'undeliverable' });
    expect(platform.addReaction).not.toHaveBeenCalled();
    expect(platform.post).toHaveBeenCalledTimes(1);
    expect(platform.post).toHaveBeenCalledWith(
      origin.channel,
      { kind: 'markdown', markdown: UNDELIVERABLE_NOTICE },
      { installationId: 'inst-1' },
    );
    // Reported whether or not the notice could be posted.
    expect(reports).toEqual([
      {
        platform: 'slack',
        channelId: origin.channel.channelId,
        ephemeralFailure: EXPECTED_EPHEMERAL_FAILURE[ephemeral],
        directFailure: 'missing_scope im:write',
      },
    ]);
    expect(JSON.stringify(reports)).not.toContain(SECRET);
    expect(JSON.stringify(reports)).not.toContain('REMEDY-TEXT');
  });
});

/** Requirement 1.13 / 1.15: header first, the original reply otherwise untouched. */
const expectHeaderedBody = (
  body: OutboundMessage,
  original: OutboundMessage,
  place: string,
  request: string,
): void => {
  const header = `${place} での「${request}」への返事です`;
  // Only the first text field gains the header; rows, footer, options and
  // the correlation id stay exactly as they were.
  switch (original.kind) {
    case 'markdown':
      expect(body).toEqual({
        ...original,
        markdown: `${header}\n\n${original.markdown}`,
      });
      return;
    case 'list':
      // One line: the title renders as a single bold line.
      expect(body).toEqual({
        ...original,
        title: `${header} — ${original.title}`,
      });
      return;
    case 'choice':
      expect(body).toEqual({
        ...original,
        prompt: `${header}\n\n${original.prompt}`,
      });
  }
};

describe('PrivateReplier.reply -- details', () => {
  let platform: MockProxy<Platform>;

  beforeEach(() => {
    platform = mock<Platform>();
    platform.postEphemeral.mockResolvedValue(EPHEMERAL.unsupported);
    platform.postDirect.mockResolvedValue(DM.ok);
    platform.addReaction.mockResolvedValue({ ok: true });
    platform.post.mockResolvedValue({ ok: true, messageId: 'n-1' });
  });

  it('names the place 「元のチャンネル」 when it cannot be looked up', async () => {
    const { replier, describePlace } = setup(platform);
    describePlace.mockResolvedValue(null);

    await replier.reply(originOf(), REPLIES[0]);

    const [, , body] = platform.postDirect.mock.calls[0];
    expectHeaderedBody(body, REPLIES[0], '元のチャンネル', 'search foo');
  });

  it('posts no short notice when a second reply of the same request lands in the DM', async () => {
    const { replier } = setup(platform);

    await replier.reply(originOf(), REPLIES[0]);
    await replier.reply(originOf(), REPLIES[1]);

    expect(platform.postDirect).toHaveBeenCalledTimes(2);
    expect(platform.addReaction).toHaveBeenCalledTimes(2);
    expect(platform.post).not.toHaveBeenCalled();
  });

  it('posts the short notice when the email reaction is refused (Teams)', async () => {
    const { replier } = setup(platform);
    platform.addReaction.mockResolvedValue({ ok: false, detail: 'bad emoji' });

    const outcome = await replier.reply(originOf(), REPLIES[0]);

    expect(outcome).toEqual({ kind: 'direct', directChannel: DM_CHANNEL });
    expect(platform.post).toHaveBeenCalledWith(
      originOf().channel,
      { kind: 'markdown', markdown: DIRECT_NOTICE },
      { installationId: 'inst-1' },
    );
  });

  it.each<{
    name: string;
    installationId: string | null;
    resolved: string | null;
    expected: { installationId: string } | undefined;
    resolverCalls: number;
  }>([
    {
      name: 'the origin installation',
      installationId: 'inst-1',
      resolved: 'inst-resolved',
      expected: { installationId: 'inst-1' },
      resolverCalls: 0,
    },
    {
      name: 'the resolved installation',
      installationId: null,
      resolved: 'inst-resolved',
      expected: { installationId: 'inst-resolved' },
      resolverCalls: 1,
    },
    {
      name: 'no scope',
      installationId: null,
      resolved: null,
      expected: undefined,
      resolverCalls: 1,
    },
  ])('passes $name as the scope of every platform call', async ({
    installationId,
    resolved,
    expected,
    resolverCalls,
  }) => {
    const { replier, resolveInstallationId } = setup(platform);
    resolveInstallationId.mockResolvedValue(resolved);
    platform.addReaction.mockResolvedValue({ ok: false, detail: 'x' });

    await replier.reply(originOf({ installationId }), REPLIES[0]);

    expect(resolveInstallationId).toHaveBeenCalledTimes(resolverCalls);
    const scopes = scopesOf(platform);
    expect(scopes).toHaveLength(4);
    expect(scopes).toEqual(scopes.map(() => expected));
  });

  it('never throws, even when every dependency rejects', async () => {
    const failing = mock<Platform>();
    failing.postEphemeral.mockRejectedValue(new Error('boom'));
    failing.postDirect.mockRejectedValue(new Error('boom'));
    failing.addReaction.mockRejectedValue(new Error('boom'));
    failing.post.mockRejectedValue(new Error('boom'));
    const { replier, describePlace, resolveInstallationId } = setup(failing);
    describePlace.mockRejectedValue(new Error('db down'));
    resolveInstallationId.mockRejectedValue(new Error('db down'));
    const throwingReport = createPrivateReplier({
      platform: failing,
      describePlace,
      resolveInstallationId,
      reportUndeliverable: () => {
        throw new Error('logger down');
      },
    });

    await expect(
      replier.reply(originOf({ installationId: null }), REPLIES[0]),
    ).resolves.toEqual({ kind: 'undeliverable' });
    await expect(throwingReport.reply(originOf(), REPLIES[0])).resolves.toEqual(
      { kind: 'undeliverable' },
    );
    await expect(
      throwingReport.acknowledge(originOf(), REPLIES[0]),
    ).resolves.toBeUndefined();
  });

  it.each<PlatformName>([
    'slack',
    'discord',
    'teams',
    'mattermost',
  ])('reports the service and channel of the request on %s', async (name) => {
    const { replier, reports } = setup(platform);
    platform.postDirect.mockResolvedValue(DM.fail);
    const origin = originOf({
      channel: testSdkChannel(name),
      actor: { ...actor, platform: name },
    });

    await replier.reply(origin, REPLIES[0]);

    expect(reports).toEqual([
      {
        platform: name,
        channelId: origin.channel.channelId,
        ephemeralFailure: 'unsupported',
        directFailure: 'missing_scope im:write',
      },
    ]);
  });
});

describe('PrivateReplier.acknowledge', () => {
  const fallback: OutboundMessage = {
    kind: 'markdown',
    markdown: '「foo」を検索しています…',
  };

  it('adds the eyes reaction and sends nothing else when it lands', async () => {
    const { platform, replier } = setup();
    platform.addReaction.mockResolvedValue({ ok: true });

    await replier.acknowledge(originOf(), fallback);

    expect(platform.addReaction).toHaveBeenCalledWith(
      { channel: originOf().channel, messageId: 'm-1' },
      'eyes',
      { installationId: 'inst-1' },
    );
    expect(platform.postEphemeral).not.toHaveBeenCalled();
    expect(platform.postDirect).not.toHaveBeenCalled();
    expect(platform.post).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'the reaction is refused', sourceMessageId: 'm-1' },
    { name: 'there is no request message', sourceMessageId: null },
  ])('sends the fallback as a private reply when $name', async ({
    sourceMessageId,
  }) => {
    const { platform, replier, resolveInstallationId } = setup();
    platform.addReaction.mockResolvedValue({ ok: false, detail: 'nope' });
    platform.postEphemeral.mockResolvedValue(EPHEMERAL.ok);

    await replier.acknowledge(
      originOf({ sourceMessageId, installationId: null }),
      fallback,
    );

    expect(platform.postEphemeral).toHaveBeenCalledWith(
      originOf().channel,
      actor,
      fallback,
      { installationId: 'inst-resolved' },
    );
    expect(resolveInstallationId).toHaveBeenCalledTimes(1);
    expect(platform.addReaction).toHaveBeenCalledTimes(
      sourceMessageId == null ? 0 : 1,
    );
    expect(platform.post).not.toHaveBeenCalled();
  });
});

describe('privateReplyOriginOf', () => {
  const invocationWith = (commandName: string, argsText: string) => ({
    platform: 'slack' as const,
    channel: testSdkChannel('slack'),
    actor: { platform: 'slack' as const, accountId: 'U1', displayName: 'Taro' },
    commandName,
    argsText,
    interaction: null,
  });

  it('addresses the requester where they asked, labelled by the command and its arguments', () => {
    const invocation = {
      ...invocationWith('search', 'how to deploy'),
      sourceMessageId: 'M1',
    };

    expect(privateReplyOriginOf(invocation, 'inst-1')).toEqual({
      channel: invocation.channel,
      actor: invocation.actor,
      sourceMessageId: 'M1',
      requestSummary: 'search how to deploy',
      installationId: 'inst-1',
    });
  });

  it('labels a request with no arguments by its command alone, and reads a missing message id as none', () => {
    const origin = privateReplyOriginOf(invocationWith('help', ''), null);

    expect(origin.requestSummary).toBe('help');
    expect(origin.sourceMessageId).toBeNull();
  });

  it('keeps only the first line, so a page body typed after it never reaches the label', () => {
    const origin = privateReplyOriginOf(
      invocationWith('create-page', '/memo first line\nsecond line'),
      null,
    );

    expect(origin.requestSummary).toBe('create-page /memo first line');
  });

  it('cuts a long label to 80 characters and marks the cut', () => {
    const origin = privateReplyOriginOf(
      invocationWith('search', 'x'.repeat(200)),
      null,
    );

    expect(origin.requestSummary).toBe(`search ${'x'.repeat(73)}…`);
  });
});
