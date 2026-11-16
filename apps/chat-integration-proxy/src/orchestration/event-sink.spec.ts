import { COMMAND_NAMES, type PlatformName } from '@growi/chat';
import { mock } from 'vitest-mock-extended';

import {
  testSdkChannel,
  testSdkChannelId,
} from '../capabilities/test-channels.js';
import {
  ADMIN_COMMAND_WORDS,
  type ArgumentCollector,
  type ArgumentCollectorPlatform,
  CommandInvocation,
  createArgumentCollector,
  LINK_COMMAND_WORD,
  type PrivateReplier,
} from '../command/index.js';
import type {
  PendingCollectionRecord,
  PendingCollectionRepository,
} from '../db/index.js';
import type {
  Invocation,
  PlatformEvent,
  PlatformEventSink,
} from '../types/index.js';
import {
  type CommandFlow,
  createEventSink,
  KNOWN_COMMAND_WORDS,
} from './event-sink.js';

const PLATFORM: PlatformName = 'slack';

const channel = testSdkChannel(PLATFORM);
const actor = {
  platform: PLATFORM,
  accountId: 'U1',
  displayName: 'Yuki',
};

// What the platform layer leaves of `text` once it drops the bot's own address.
const mentionEvent = (text: string): PlatformEvent => ({
  kind: 'mention',
  platform: PLATFORM,
  channel,
  actor,
  text,
  textWithoutBotAddress: text.replace(/^@growi(?=\s|$)/, '').trim(),
  inDirectMessage: false,
  messageId: 'M0001',
  threadRootId: null,
  replyThreadRootId: null,
  interaction: null,
});

const slashEvent = (command: string, text = ''): PlatformEvent => ({
  kind: 'slash-command',
  platform: PLATFORM,
  channel,
  actor,
  command,
  text,
  interaction: null,
});

const modalSubmitEvent: PlatformEvent = {
  kind: 'modal-submit',
  platform: PLATFORM,
  channel,
  actor,
  correlationId: 'corr-1',
  values: { keyword: 'foo' },
};

const actionEvent: PlatformEvent = {
  kind: 'action',
  platform: PLATFORM,
  channel,
  actor,
  correlationId: 'corr-1',
  actionId: 'a1',
  value: 'foo',
  interaction: null,
};

const linkPostedEvent: PlatformEvent = {
  kind: 'link-posted',
  platform: PLATFORM,
  channel,
  actor,
  messageRef: { channel, messageId: 'M1' },
  urls: ['https://growi.example.com/some/page'],
};

const anInvocation: Invocation = {
  platform: PLATFORM,
  channel,
  actor,
  commandName: COMMAND_NAMES.search,
  argsText: 'foo',
  interaction: null,
};

/**
 * `resume` is stubbed per test, so the default here is the one outcome that
 * means "nothing to do" -- a test that cares about another outcome says so.
 */
const setup = () => {
  const flow = mock<CommandFlow>();
  const collector = mock<Pick<ArgumentCollector, 'resume'>>();
  collector.resume.mockResolvedValue({ status: 'not-mine' });
  return { flow, collector, sink: createEventSink({ flow, collector }) };
};

describe('the vocabulary a mention is recognized against', () => {
  it('holds every word a user or an operator can actually type', () => {
    // Derived from the three declared sources rather than listed by hand: a
    // command added to `COMMAND_TRAITS` or `ADMIN_COMMAND_WORDS` must become
    // typeable without editing this file (and without editing `event-sink.ts`).
    expect([...KNOWN_COMMAND_WORDS].sort()).toEqual(
      [
        ...Object.values(COMMAND_NAMES),
        LINK_COMMAND_WORD,
        ...ADMIN_COMMAND_WORDS,
      ].sort(),
    );
  });
});

describe('every PlatformEvent kind reaches its declared destination', () => {
  it('sends a mention naming a command to the command flow', async () => {
    const { sink, flow, collector } = setup();

    await sink.handle(mentionEvent(`@growi ${COMMAND_NAMES.search} foo`));

    expect(flow.startCommand).toHaveBeenCalledWith({
      ...anInvocation,
      sourceMessageId: 'M0001',
    });
    expect(collector.resume).not.toHaveBeenCalled();
    expect(flow.previewLinks).not.toHaveBeenCalled();
  });

  it('sends a slash command straight to the command flow', async () => {
    const { sink, flow, collector } = setup();

    await sink.handle(slashEvent(COMMAND_NAMES.search, 'foo'));

    expect(flow.startCommand).toHaveBeenCalledWith({
      ...anInvocation,
      sourceMessageId: null,
    });
    expect(collector.resume).not.toHaveBeenCalled();
  });

  it('sends a modal submission to the argument collector', async () => {
    const { sink, flow, collector } = setup();

    await sink.handle(modalSubmitEvent);

    expect(collector.resume).toHaveBeenCalledWith(modalSubmitEvent);
    expect(flow.startCommand).not.toHaveBeenCalled();
  });

  it('sends a button press or list choice to the argument collector', async () => {
    const { sink, flow, collector } = setup();

    await sink.handle(actionEvent);

    expect(collector.resume).toHaveBeenCalledWith(actionEvent);
    expect(flow.startCommand).not.toHaveBeenCalled();
  });

  it('sends a posted URL to the preview flow, never through command parsing', async () => {
    const { sink, flow, collector } = setup();

    await sink.handle(linkPostedEvent);

    expect(flow.previewLinks).toHaveBeenCalledWith(linkPostedEvent);
    expect(flow.startCommand).not.toHaveBeenCalled();
    expect(collector.resume).not.toHaveBeenCalled();
  });
});

describe("a mention's three-step order", () => {
  it('hands a word that is not a command to the collector, to resume with', async () => {
    const { sink, flow, collector } = setup();
    const event = mentionEvent('@growi こんにちは');

    await sink.handle(event);

    expect(flow.startCommand).not.toHaveBeenCalled();
    expect(collector.resume).toHaveBeenCalledWith(event);
  });

  it('does nothing at all when the collector answers not-mine', async () => {
    const { sink, flow, collector } = setup();
    collector.resume.mockResolvedValue({ status: 'not-mine' });

    await sink.handle(mentionEvent('@growi こんにちは'));

    expect(flow.startCommand).not.toHaveBeenCalled();
    expect(flow.runCollected).not.toHaveBeenCalled();
    expect(flow.previewLinks).not.toHaveBeenCalled();
  });

  it('treats a bare mention with nothing after it as an ordinary message', async () => {
    // `normalize` answers an empty `commandName` here rather than throwing
    // (task 4.1), so this lands on step 2 like any other unrecognized word --
    // the empty string must never be looked up as if it were a command.
    const { sink, flow, collector } = setup();
    const event = mentionEvent('@growi');

    await sink.handle(event);

    expect(flow.startCommand).not.toHaveBeenCalled();
    expect(collector.resume).toHaveBeenCalledWith(event);
  });

  it('recognizes an operator command typed as a mention', async () => {
    const { sink, flow, collector } = setup();

    await sink.handle(mentionEvent('@growi register'));

    expect(flow.startCommand).toHaveBeenCalledWith(
      expect.objectContaining({ commandName: 'register', argsText: '' }),
    );
    expect(collector.resume).not.toHaveBeenCalled();
  });

  it('recognizes the account-link command typed as a mention', async () => {
    const { sink, flow, collector } = setup();

    await sink.handle(mentionEvent(`@growi ${LINK_COMMAND_WORD}`));

    expect(flow.startCommand).toHaveBeenCalledWith(
      expect.objectContaining({ commandName: LINK_COMMAND_WORD, argsText: '' }),
    );
    expect(collector.resume).not.toHaveBeenCalled();
  });
});

describe('a new command supersedes a half-finished one', () => {
  it('routes a command word to the flow even while a collection is in flight, never to resume', async () => {
    // The discard itself belongs to `ArgumentCollector.start` (task 4.4), and
    // this is what lets it happen: were a recognized command word handed to
    // `resume` first, `resume`'s mention branch would read it as the ANSWER to
    // the outstanding question and the half-finished collection would swallow
    // the new command instead of being discarded by it.
    const { sink, flow, collector } = setup();
    collector.resume.mockResolvedValue({
      status: 'collected',
      values: { path: '/x' },
      invocation: anInvocation,
    });

    await sink.handle(mentionEvent(`@growi ${COMMAND_NAMES.createPage} /a b`));

    expect(collector.resume).not.toHaveBeenCalled();
    expect(flow.startCommand).toHaveBeenCalledWith(
      expect.objectContaining({ commandName: COMMAND_NAMES.createPage }),
    );
  });
});

describe('what each resume outcome leads to', () => {
  it('runs the command once the collector reports every value collected', async () => {
    const { sink, flow, collector } = setup();
    collector.resume.mockResolvedValue({
      status: 'collected',
      values: { keyword: 'foo' },
      invocation: anInvocation,
    });

    await sink.handle(modalSubmitEvent);

    expect(flow.runCollected).toHaveBeenCalledWith(anInvocation, {
      keyword: 'foo',
    });
  });

  it('runs the command against the GROWI the user picked, values and all', async () => {
    // Requirement 8.2. The values were collected BEFORE the question was
    // asked, so they come back with the answer and nothing is asked twice.
    const { sink, flow, collector } = setup();
    collector.resume.mockResolvedValue({
      status: 'growi-chosen',
      invocation: anInvocation,
      values: { path: '/memo', body: 'text' },
      relationId: 'rel-b',
    });

    await sink.handle(actionEvent);

    expect(flow.runChosenGrowi).toHaveBeenCalledWith(
      anInvocation,
      { path: '/memo', body: 'text' },
      'rel-b',
    );
    expect(flow.runCollected).not.toHaveBeenCalled();
  });

  it('tells the user when their half-finished input has expired', async () => {
    // The user is present and reachable here, so the input vanishing is worth
    // saying -- and only the flow can post.
    const { sink, flow, collector } = setup();
    collector.resume.mockResolvedValue({ status: 'expired' });

    await sink.handle(modalSubmitEvent);

    expect(flow.reportExpired).toHaveBeenCalledWith(modalSubmitEvent);
    expect(flow.runCollected).not.toHaveBeenCalled();
  });

  it.each([
    'pending',
    'cancelled',
    'not-mine',
  ] as const)('leaves the flow untouched when the collector answers %s', async (status) => {
    const { sink, flow, collector } = setup();
    collector.resume.mockResolvedValue({ status });

    await sink.handle(modalSubmitEvent);

    expect(flow.runCollected).not.toHaveBeenCalled();
    expect(flow.startCommand).not.toHaveBeenCalled();
    expect(flow.previewLinks).not.toHaveBeenCalled();
    expect(flow.runChosenGrowi).not.toHaveBeenCalled();
    expect(flow.reportExpired).not.toHaveBeenCalled();
  });
});

describe('PlatformEvent', () => {
  it('constructs every declared kind, and excludes `reply`', () => {
    const channel = testSdkChannel('discord');
    const actor = {
      platform: 'discord',
      accountId: 'U1',
      displayName: 'Alice',
    } as const;

    const events: readonly PlatformEvent[] = [
      {
        kind: 'mention',
        platform: 'discord',
        channel,
        actor,
        text: 'hi',
        textWithoutBotAddress: 'hi',
        inDirectMessage: false,
        messageId: 'M0001',
        threadRootId: null,
        replyThreadRootId: null,
        interaction: null,
      },
      {
        kind: 'slash-command',
        platform: 'discord',
        channel,
        actor,
        command: 'search',
        text: 'growi',
        interaction: { token: 't1' },
      },
      {
        kind: 'modal-submit',
        platform: 'discord',
        channel,
        actor,
        correlationId: 'corr1',
        values: { path: '/foo' },
      },
      {
        kind: 'action',
        platform: 'discord',
        channel,
        actor,
        correlationId: 'corr1',
        actionId: 'select-growi',
        value: 'rel_1',
        interaction: { token: 't1' },
      },
      {
        kind: 'link-posted',
        platform: 'discord',
        channel,
        actor,
        messageRef: { channel, messageId: 'M1' },
        urls: ['https://growi.example.com/foo'],
      },
    ];

    expect(events.map((event) => event.kind)).toEqual([
      'mention',
      'slash-command',
      'modal-submit',
      'action',
      'link-posted',
    ]);
    // `reply` was deliberately removed from PlatformEvent (design.md:
    // "plainReply に依存しないと決めた...`PlatformEvent` の型からも外す").
    // This is a compile-time-only check (no runtime assertion possible: at
    // runtime the type system's erasure means there's nothing to observe)
    // -- the `@ts-expect-error` below is what fails the build if `'reply'`
    // is ever re-added to `PlatformEvent['kind']`.
    // @ts-expect-error -- `'reply'` is not a member of `PlatformEvent['kind']`.
    const rejectedKind: PlatformEvent['kind'] = 'reply';
    expect(events.every((event) => event.kind !== rejectedKind)).toBe(true);
  });

  it('declares the sink a mapped event is handed to, taking any of the five kinds', async () => {
    const handled: PlatformEvent[] = [];
    const sink: PlatformEventSink = {
      handle: (event) => {
        handled.push(event);
        return Promise.resolve();
      },
    };

    await sink.handle({
      kind: 'mention',
      platform: 'discord',
      channel: testSdkChannel('discord'),
      actor: { platform: 'discord', accountId: 'U1', displayName: 'Alice' },
      text: 'hi',
      textWithoutBotAddress: 'hi',
      inDirectMessage: false,
      messageId: 'M0001',
      threadRootId: null,
      replyThreadRootId: null,
      interaction: null,
    });

    expect(handled.map((event) => event.kind)).toEqual(['mention']);
  });
});

describe("Slack's AI app view: every typed message is an agent request (15.15)", () => {
  const dm = testSdkChannel('slack', {
    channelId: testSdkChannelId('slack', 'D1'),
    isPrivate: true,
  });

  /** A message typed into the bot's DM; under the view, it roots its own thread. */
  const typedInDm = (
    text: string,
    platform: PlatformName = 'slack',
  ): Extract<PlatformEvent, { kind: 'mention' }> => ({
    kind: 'mention',
    platform,
    channel:
      platform === 'slack'
        ? dm
        : testSdkChannel(platform, {
            channelId: testSdkChannelId(platform, 'D1'),
          }),
    actor: { ...actor, platform },
    text,
    textWithoutBotAddress: text,
    inDirectMessage: true,
    messageId: 'M0009',
    threadRootId: null,
    replyThreadRootId: 'M0009',
    interaction: null,
  });

  const agentRequestFor = (text: string) =>
    expect.objectContaining({
      commandName: COMMAND_NAMES.agent,
      argsText: text,
      channel: dm,
      sourceMessageId: 'M0009',
      replyThreadRootId: 'M0009',
      isDirectMessage: true,
    });

  const setupView = (agentViewPlatforms: ReadonlySet<PlatformName>) => {
    const flow = mock<CommandFlow>();
    const collector = mock<Pick<ArgumentCollector, 'resume'>>();
    collector.resume.mockResolvedValue({ status: 'not-mine' });
    return {
      flow,
      collector,
      sink: createEventSink({ flow, collector, agentViewPlatforms }),
    };
  };
  const VIEW_ON = new Set<PlatformName>(['slack']);

  it('starts an agent request with the whole text when it starts with "search"', async () => {
    const { sink, flow } = setupView(VIEW_ON);

    await sink.handle(typedInDm('search for the release notes'));

    expect(flow.startCommand).toHaveBeenCalledTimes(1);
    expect(flow.startCommand).toHaveBeenCalledWith(
      agentRequestFor('search for the release notes'),
    );
  });

  it.each([
    COMMAND_NAMES.createPage,
    COMMAND_NAMES.help,
    LINK_COMMAND_WORD,
    ...ADMIN_COMMAND_WORDS,
  ])('starts an agent request, not "%s", whatever command the first word names', async (word) => {
    const { sink, flow } = setupView(VIEW_ON);

    await sink.handle(typedInDm(`${word} please`));

    expect(flow.startCommand).toHaveBeenCalledTimes(1);
    expect(flow.startCommand).toHaveBeenCalledWith(
      agentRequestFor(`${word} please`),
    );
  });

  it('starts an agent request for text naming no command, which an ordinary DM ignores', async () => {
    const { sink, flow } = setupView(VIEW_ON);

    await sink.handle(typedInDm('今週の議事録はどこ？'));

    expect(flow.startCommand).toHaveBeenCalledWith(
      agentRequestFor('今週の議事録はどこ？'),
    );
  });

  it('asks the collector first, in the mode that drops a question the text does not answer', async () => {
    const { sink, collector } = setupView(VIEW_ON);
    const event = typedInDm('search for the release notes');

    await sink.handle(event);

    expect(collector.resume).toHaveBeenCalledWith(event, {
      releaseUnanswered: true,
    });
  });

  it('runs the command against the GROWI the text chose, instead of starting a request', async () => {
    const { sink, flow, collector } = setupView(VIEW_ON);
    collector.resume.mockResolvedValue({
      status: 'growi-chosen',
      invocation: anInvocation,
      values: { path: '/memo' },
      relationId: 'rel-b',
    });

    await sink.handle(typedInDm('2'));

    expect(flow.runChosenGrowi).toHaveBeenCalledWith(
      anInvocation,
      { path: '/memo' },
      'rel-b',
    );
    expect(flow.startCommand).not.toHaveBeenCalled();
  });

  it('runs the command once the text completes the values asked for', async () => {
    const { sink, flow, collector } = setupView(VIEW_ON);
    collector.resume.mockResolvedValue({
      status: 'collected',
      values: { keyword: 'foo' },
      invocation: anInvocation,
    });

    await sink.handle(typedInDm('foo'));

    expect(flow.runCollected).toHaveBeenCalledWith(anInvocation, {
      keyword: 'foo',
    });
    expect(flow.startCommand).not.toHaveBeenCalled();
  });

  it.each([
    'pending',
    'cancelled',
  ] as const)('starts nothing new when the text was taken as an answer (%s)', async (status) => {
    const { sink, flow, collector } = setupView(VIEW_ON);
    collector.resume.mockResolvedValue({ status });

    await sink.handle(typedInDm('foo'));

    expect(flow.startCommand).not.toHaveBeenCalled();
  });

  it.each([
    'released',
    'expired',
  ] as const)('starts an agent request when the outstanding question is gone (%s)', async (status) => {
    const { sink, flow, collector } = setupView(VIEW_ON);
    collector.resume.mockResolvedValue({ status });

    await sink.handle(typedInDm('別の質問です'));

    expect(flow.startCommand).toHaveBeenCalledWith(
      agentRequestFor('別の質問です'),
    );
    expect(flow.reportExpired).not.toHaveBeenCalled();
  });

  describe('everywhere else, routing is unchanged', () => {
    it('keeps "search" a search in a DM while the view is off', async () => {
      const { sink, flow, collector } = setupView(new Set());

      await sink.handle(typedInDm('search for the release notes'));

      expect(flow.startCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          commandName: COMMAND_NAMES.search,
          argsText: 'for the release notes',
        }),
      );
      expect(collector.resume).not.toHaveBeenCalled();
    });

    it('keeps "search" a search when no view setting is handed over at all', async () => {
      const flow = mock<CommandFlow>();
      const collector = mock<Pick<ArgumentCollector, 'resume'>>();
      const sink = createEventSink({ flow, collector });

      await sink.handle(typedInDm('search for the release notes'));

      expect(flow.startCommand).toHaveBeenCalledWith(
        expect.objectContaining({ commandName: COMMAND_NAMES.search }),
      );
    });

    it('keeps "search" a search in a Slack channel while the view is on', async () => {
      const { sink, flow } = setupView(VIEW_ON);

      await sink.handle(mentionEvent('@growi search for the release notes'));

      expect(flow.startCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          commandName: COMMAND_NAMES.search,
          argsText: 'for the release notes',
        }),
      );
    });

    it('keeps "search" a search in another service\'s DM while Slack\'s view is on', async () => {
      const { sink, flow } = setupView(VIEW_ON);

      await sink.handle(
        typedInDm('search for the release notes', 'mattermost'),
      );

      expect(flow.startCommand).toHaveBeenCalledWith(
        expect.objectContaining({ commandName: COMMAND_NAMES.search }),
      );
    });

    it('ignores text naming no command in a DM while the view is off', async () => {
      const { sink, flow, collector } = setupView(new Set());
      const event = typedInDm('今週の議事録はどこ？');

      await sink.handle(event);

      expect(flow.startCommand).not.toHaveBeenCalled();
      expect(collector.resume).toHaveBeenCalledWith(event);
    });
  });

  describe('with the real argument collector behind it', () => {
    const OPTIONS = [
      { relationId: 'rel-a', growiLabel: 'GROWI A' },
      { relationId: 'rel-b', growiLabel: 'GROWI B' },
    ];

    /** Just enough of the table for one user in one DM. */
    const inMemoryCollections = () => {
      const rows = new Map<string, PendingCollectionRecord>();
      const repository = mock<PendingCollectionRepository>({
        create: (row) => {
          const record = { ...row, relationId: null };
          rows.set(row.correlationId, record);
          return Promise.resolve(record);
        },
        findByCorrelationId: (correlationId) =>
          Promise.resolve(rows.get(correlationId) ?? null),
        findInFlight: (platform, channelId, actorAccountId) =>
          Promise.resolve(
            [...rows.values()].find(
              (row) =>
                row.platform === platform &&
                row.channelId === channelId &&
                row.actorAccountId === actorAccountId,
            ) ?? null,
          ),
        remove: (correlationId) => {
          rows.delete(correlationId);
          return Promise.resolve();
        },
      });
      return { rows, repository };
    };

    const setupWithCollector = async () => {
      const { rows, repository } = inMemoryCollections();
      const privateReplier = mock<PrivateReplier>();
      privateReplier.reply.mockResolvedValue({ kind: 'in-place' });
      const collector = createArgumentCollector({
        pendingCollections: repository,
        platform: mock<ArgumentCollectorPlatform>(),
        privateReplier,
      });
      // A GROWI choice left open in this DM, as `create-page` asked it.
      await collector.startGrowiChoice(
        { ...CommandInvocation.normalize(typedInDm('create-page /memo x')) },
        { path: '/memo', body: 'x' },
        OPTIONS,
      );
      const flow = mock<CommandFlow>();
      return {
        rows,
        flow,
        sink: createEventSink({ flow, collector, agentViewPlatforms: VIEW_ON }),
      };
    };

    it('starts a new agent request from text that does not choose a GROWI, and drops the choice', async () => {
      const { rows, flow, sink } = await setupWithCollector();

      await sink.handle(typedInDm('今週の議事録を探して'));

      expect(flow.startCommand).toHaveBeenCalledWith(
        agentRequestFor('今週の議事録を探して'),
      );
      expect(flow.runChosenGrowi).not.toHaveBeenCalled();
      expect(rows.size).toBe(0);
    });

    it('takes a numbered answer as the choice, and starts no request', async () => {
      const { flow, sink } = await setupWithCollector();

      await sink.handle(typedInDm('2'));

      expect(flow.runChosenGrowi).toHaveBeenCalledWith(
        expect.objectContaining({ commandName: COMMAND_NAMES.createPage }),
        { path: '/memo', body: 'x' },
        'rel-b',
      );
      expect(flow.startCommand).not.toHaveBeenCalled();
    });
  });
});
