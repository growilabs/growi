import { COMMAND_NAMES, type PlatformName } from '@growi/chat';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type {
  NewPendingCollection,
  PendingCollectionRecord,
  PendingCollectionRepository,
} from '../db/index.js';
import type { FieldSpec, Invocation, PlatformEvent } from '../types/index.js';
import {
  type ArgumentCollector,
  type ArgumentCollectorPlatform,
  createArgumentCollector,
  type ResumeOutcome,
} from './argument-collector.js';
import { COMMAND_TRAITS } from './command-set.js';

/**
 * A real in-memory `PendingCollectionRepository` rather than a mock: every
 * assertion here is about a collection SURVIVING between two calls (and, in
 * the "another process" test, between two collector instances), which a
 * per-call stub cannot express.
 */
const createFakeRepository = (): PendingCollectionRepository & {
  readonly rows: Map<string, PendingCollectionRecord>;
} => {
  const rows = new Map<string, PendingCollectionRecord>();
  return {
    rows,
    create: (collection: NewPendingCollection) => {
      const record: PendingCollectionRecord = {
        ...collection,
        relationId: collection.relationId ?? null,
      };
      rows.set(record.correlationId, record);
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
    update: (correlationId, update) => {
      const row = rows.get(correlationId);
      if (row == null) throw new Error(`no such row: ${correlationId}`);
      rows.set(correlationId, {
        ...row,
        ...(update.relationId !== undefined && {
          relationId: update.relationId,
        }),
        ...(update.collected !== undefined && { collected: update.collected }),
        ...(update.offeredOptions !== undefined && {
          offeredOptions: update.offeredOptions,
        }),
        ...(update.expiresAt !== undefined && { expiresAt: update.expiresAt }),
      });
      return Promise.resolve();
    },
    remove: (correlationId) => {
      rows.delete(correlationId);
      return Promise.resolve();
    },
    deleteExpired: (now) => {
      const expired = [...rows.values()].filter(
        (row) => row.expiresAt.getTime() <= now.getTime(),
      );
      for (const row of expired) rows.delete(row.correlationId);
      return Promise.resolve(expired.length);
    },
    deleteByRelation: (relationId) => {
      const matched = [...rows.values()].filter(
        (row) => row.relationId === relationId,
      );
      for (const row of matched) rows.delete(row.correlationId);
      return Promise.resolve(matched.length);
    },
  };
};

const channelOf = (platform: PlatformName) => ({
  platform,
  channelId: 'C1',
  channelName: 'general',
  isPrivate: false,
});

const actorOf = (platform: PlatformName) => ({
  platform,
  accountId: 'U1',
  displayName: 'Taro',
});

const invocationOf = (
  platform: PlatformName,
  commandName: string,
  argsText = '',
  withInteraction = false,
): Invocation => ({
  platform,
  channel: channelOf(platform),
  actor: actorOf(platform),
  commandName,
  argsText,
  interaction: withInteraction ? { token: 'trigger-1' } : null,
});

const mentionAnswer = (
  platform: PlatformName,
  text: string,
): PlatformEvent => ({
  kind: 'mention',
  platform,
  channel: channelOf(platform),
  actor: actorOf(platform),
  text: `@growi ${text}`,
  interaction: null,
});

const modalSubmit = (
  platform: PlatformName,
  correlationId: string,
  values: Readonly<Record<string, string>>,
): PlatformEvent => ({
  kind: 'modal-submit',
  platform,
  channel: channelOf(platform),
  actor: actorOf(platform),
  correlationId,
  values,
});

const CREATE_PAGE_FIELDS = COMMAND_TRAITS[COMMAND_NAMES.createPage].fields;
const SEARCH_FIELDS = COMMAND_TRAITS[COMMAND_NAMES.search].fields;

const NOW = new Date('2026-09-01T00:00:00.000Z');

describe('ArgumentCollector.start', () => {
  let repository: ReturnType<typeof createFakeRepository>;
  let platform: ArgumentCollectorPlatform;

  beforeEach(() => {
    repository = createFakeRepository();
    platform = mock<ArgumentCollectorPlatform>();
    vi.mocked(platform.openModal).mockResolvedValue(true);
    vi.mocked(platform.postEphemeral).mockResolvedValue({
      ok: true,
      messageId: 'M1',
    });
  });

  const collector = () =>
    createArgumentCollector({
      pendingCollections: repository,
      platform,
      now: () => NOW,
      newCorrelationId: () => 'corr-1',
    });

  it('collects everything from the command line without asking, even where a modal is available', async () => {
    const outcome = await collector().start(
      invocationOf(
        'slack',
        COMMAND_NAMES.createPage,
        '/memo/today body text',
        true,
      ),
      CREATE_PAGE_FIELDS,
    );

    expect(outcome).toEqual({
      status: 'collected',
      values: { path: '/memo/today', body: 'body text' },
    });
    expect(platform.openModal).not.toHaveBeenCalled();
    expect(platform.postEphemeral).not.toHaveBeenCalled();
    expect(repository.rows.size).toBe(0);
  });

  it('collects nothing, and asks nothing, for a command that declares no fields', async () => {
    const outcome = await collector().start(
      invocationOf('slack', COMMAND_NAMES.help, '', true),
      COMMAND_TRAITS[COMMAND_NAMES.help].fields,
    );

    expect(outcome).toEqual({ status: 'collected', values: {} });
    expect(platform.openModal).not.toHaveBeenCalled();
    expect(platform.postEphemeral).not.toHaveBeenCalled();
    expect(repository.rows.size).toBe(0);
  });

  it('gives the whole remainder to a single field', async () => {
    const outcome = await collector().start(
      invocationOf('discord', COMMAND_NAMES.search, 'how to deploy'),
      SEARCH_FIELDS,
    );

    expect(outcome).toEqual({
      status: 'collected',
      values: { keyword: 'how to deploy' },
    });
  });

  it('opens a modal declaring the same fields when the platform supports it and a trigger is present', async () => {
    const outcome = await collector().start(
      invocationOf('slack', COMMAND_NAMES.createPage, '', true),
      CREATE_PAGE_FIELDS,
    );

    expect(outcome).toEqual({ status: 'pending', correlationId: 'corr-1' });
    expect(platform.openModal).toHaveBeenCalledWith(
      { token: 'trigger-1' },
      { title: COMMAND_NAMES.createPage, fields: CREATE_PAGE_FIELDS },
      'corr-1',
    );
    expect(platform.postEphemeral).not.toHaveBeenCalled();
    expect(repository.rows.get('corr-1')?.commandName).toBe(
      COMMAND_NAMES.createPage,
    );
  });

  it('falls back to asking when the platform supports modals but the invocation carries no trigger', async () => {
    const outcome = await collector().start(
      invocationOf('slack', COMMAND_NAMES.createPage, ''),
      CREATE_PAGE_FIELDS,
    );

    expect(outcome).toEqual({ status: 'pending', correlationId: 'corr-1' });
    expect(platform.openModal).not.toHaveBeenCalled();
    expect(platform.postEphemeral).toHaveBeenCalledTimes(1);
  });

  it('reads the capability table, not the platform name: a service the table marks as having no modal is asked, trigger or not', async () => {
    const outcome = await collector().start(
      invocationOf('mattermost', COMMAND_NAMES.createPage, '', true),
      CREATE_PAGE_FIELDS,
    );

    expect(outcome).toEqual({ status: 'pending', correlationId: 'corr-1' });
    expect(platform.openModal).not.toHaveBeenCalled();
    expect(platform.postEphemeral).toHaveBeenCalledTimes(1);
  });

  it('falls back to asking when the modal could not be opened', async () => {
    vi.mocked(platform.openModal).mockResolvedValue(false);

    const outcome = await collector().start(
      invocationOf('slack', COMMAND_NAMES.createPage, '', true),
      CREATE_PAGE_FIELDS,
    );

    expect(outcome).toEqual({ status: 'pending', correlationId: 'corr-1' });
    expect(platform.postEphemeral).toHaveBeenCalledTimes(1);
  });

  it('asks only for what the command line did not already fill, on a platform without modals', async () => {
    const outcome = await collector().start(
      invocationOf('mattermost', COMMAND_NAMES.createPage, '/memo/today'),
      CREATE_PAGE_FIELDS,
    );

    expect(outcome).toEqual({ status: 'pending', correlationId: 'corr-1' });
    expect(platform.openModal).not.toHaveBeenCalled();
    const [, , message] = vi.mocked(platform.postEphemeral).mock.calls[0];
    expect(message.kind === 'markdown' && message.markdown).toContain('Body');
  });

  it('reports unavailable and keeps no half-finished row when the question could not be posted', async () => {
    vi.mocked(platform.postEphemeral).mockResolvedValue({
      ok: false,
      reason: 'bot-not-in-channel',
      remedy: 'invite the bot',
    });

    const outcome = await collector().start(
      invocationOf('mattermost', COMMAND_NAMES.createPage, ''),
      CREATE_PAGE_FIELDS,
    );

    expect(outcome).toEqual({
      status: 'unavailable',
      reason: 'invite the bot',
    });
    expect(repository.rows.size).toBe(0);
  });

  it('discards the collection already in flight for the same channel and user, whatever wrote it', async () => {
    repository.rows.set('older', {
      correlationId: 'older',
      relationId: null,
      platform: 'mattermost',
      channelId: 'C1',
      actorAccountId: 'U1',
      commandName: COMMAND_NAMES.search,
      invocation: invocationOf('mattermost', COMMAND_NAMES.search),
      // Deliberately not this component's own state shape: a pending GROWI
      // choice written elsewhere is still an in-flight collection.
      collected: { chosenBy: 'someone-else' },
      offeredOptions: [{ id: 'r1', label: 'GROWI A' }],
      expiresAt: new Date(NOW.getTime() + 60_000),
    });

    await collector().start(
      invocationOf('mattermost', COMMAND_NAMES.createPage, ''),
      CREATE_PAGE_FIELDS,
    );

    expect([...repository.rows.keys()]).toEqual(['corr-1']);
  });

  it('tells the user which command the discarded input belonged to', async () => {
    repository.rows.set('older', {
      correlationId: 'older',
      relationId: null,
      platform: 'mattermost',
      channelId: 'C1',
      actorAccountId: 'U1',
      commandName: COMMAND_NAMES.search,
      invocation: invocationOf('mattermost', COMMAND_NAMES.search),
      collected: { chosenBy: 'someone-else' },
      offeredOptions: [],
      expiresAt: new Date(NOW.getTime() + 60_000),
    });

    await collector().start(
      invocationOf('mattermost', COMMAND_NAMES.createPage, '/memo/today body'),
      CREATE_PAGE_FIELDS,
    );

    // The command line was complete, so the only reason to post anything at
    // all is the discard -- design.md's 「破棄したことを利用者に示す」.
    expect(platform.postEphemeral).toHaveBeenCalledTimes(1);
    const [channel, actor, message] = vi.mocked(platform.postEphemeral).mock
      .calls[0];
    expect(channel.channelId).toBe('C1');
    expect(actor.accountId).toBe('U1');
    expect(message.kind === 'markdown' && message.markdown).toContain(
      COMMAND_NAMES.search,
    );
  });

  it('tells the user about the discard even when the new command cannot proceed', async () => {
    repository.rows.set('older', {
      correlationId: 'older',
      relationId: null,
      platform: 'mattermost',
      channelId: 'C1',
      actorAccountId: 'U1',
      commandName: COMMAND_NAMES.search,
      invocation: invocationOf('mattermost', COMMAND_NAMES.search),
      collected: { chosenBy: 'someone-else' },
      offeredOptions: [],
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    vi.mocked(platform.postEphemeral).mockResolvedValue({
      ok: false,
      reason: 'bot-not-in-channel',
      remedy: 'invite the bot',
    });

    const outcome = await collector().start(
      invocationOf('mattermost', COMMAND_NAMES.createPage, ''),
      CREATE_PAGE_FIELDS,
    );

    // Losing the earlier input silently is the worse half of this failure:
    // the attempt to say so must be made before the new command gives up.
    const notice = vi
      .mocked(platform.postEphemeral)
      .mock.calls.map(([, , message]) =>
        message.kind === 'markdown' ? message.markdown : '',
      )
      .find((markdown) => markdown.includes(COMMAND_NAMES.search));
    expect(notice).toBeDefined();
    expect(outcome).toEqual({
      status: 'unavailable',
      reason: 'invite the bot',
    });
    expect(repository.rows.size).toBe(0);
  });

  it('leaves exactly one row in flight when the same user starts twice', async () => {
    let n = 0;
    const twice = createArgumentCollector({
      pendingCollections: repository,
      platform,
      now: () => NOW,
      newCorrelationId: () => `corr-${++n}`,
    });

    await twice.start(
      invocationOf('mattermost', COMMAND_NAMES.createPage, ''),
      CREATE_PAGE_FIELDS,
    );
    await twice.start(
      invocationOf('mattermost', COMMAND_NAMES.keep, ''),
      COMMAND_TRAITS[COMMAND_NAMES.keep].fields,
    );

    expect(repository.rows.size).toBe(1);
  });
});

describe('ArgumentCollector.resume', () => {
  let repository: ReturnType<typeof createFakeRepository>;
  let platform: ArgumentCollectorPlatform;

  beforeEach(() => {
    repository = createFakeRepository();
    platform = mock<ArgumentCollectorPlatform>();
    vi.mocked(platform.openModal).mockResolvedValue(true);
    vi.mocked(platform.postEphemeral).mockResolvedValue({
      ok: true,
      messageId: 'M1',
    });
  });

  const collectorAt = (now: Date) =>
    createArgumentCollector({
      pendingCollections: repository,
      platform,
      now: () => now,
      newCorrelationId: () => 'corr-1',
    });

  it('ignores an event whose collection it does not have', async () => {
    const outcome = await collectorAt(NOW).resume(
      modalSubmit('slack', 'unknown', { path: '/a', body: 'b' }),
    );

    expect(outcome).toEqual({ status: 'not-mine' });
  });

  it('ignores an event whose collection was written by something else', async () => {
    repository.rows.set('corr-x', {
      correlationId: 'corr-x',
      relationId: null,
      platform: 'slack',
      channelId: 'C1',
      actorAccountId: 'U1',
      commandName: COMMAND_NAMES.search,
      invocation: invocationOf('slack', COMMAND_NAMES.search),
      collected: { chosenBy: 'someone-else' },
      offeredOptions: [],
      expiresAt: new Date(NOW.getTime() + 60_000),
    });

    const outcome = await collectorAt(NOW).resume(
      modalSubmit('slack', 'corr-x', { path: '/a' }),
    );

    expect(outcome).toEqual({ status: 'not-mine' });
  });

  it('reports an expired collection and removes it', async () => {
    const invocation = invocationOf(
      'slack',
      COMMAND_NAMES.createPage,
      '',
      true,
    );
    await collectorAt(NOW).start(invocation, CREATE_PAGE_FIELDS);

    const later = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const outcome = await collectorAt(later).resume(
      modalSubmit('slack', 'corr-1', { path: '/a', body: 'b' }),
    );

    expect(outcome).toEqual({ status: 'expired' });
    expect(repository.rows.size).toBe(0);
  });

  it('ignores a mention when nothing is in flight for that channel and user', async () => {
    const outcome = await collectorAt(NOW).resume(
      mentionAnswer('mattermost', 'hello everyone'),
    );

    expect(outcome).toEqual({ status: 'not-mine' });
  });

  it('keeps a multi-line answer intact, address token aside', async () => {
    const invocation = invocationOf(
      'mattermost',
      COMMAND_NAMES.createPage,
      '/memo/today',
    );
    await collectorAt(NOW).start(invocation, CREATE_PAGE_FIELDS);

    const outcome = await collectorAt(NOW).resume(
      mentionAnswer('mattermost', 'first line\nsecond line'),
    );

    expect(outcome).toEqual({
      status: 'collected',
      values: { path: '/memo/today', body: 'first line\nsecond line' },
      invocation,
    });
  });

  it('ends the collection when the next question can no longer be posted', async () => {
    await collectorAt(NOW).start(
      invocationOf('mattermost', COMMAND_NAMES.createPage, ''),
      CREATE_PAGE_FIELDS,
    );
    vi.mocked(platform.postEphemeral).mockResolvedValue({
      ok: false,
      reason: 'bot-not-in-channel',
      remedy: 'invite the bot',
    });

    const outcome = await collectorAt(NOW).resume(
      mentionAnswer('mattermost', '/memo/today'),
    );

    // Not `not-mine`: that means "an ordinary message, do nothing", and the
    // caller would never learn the collection it started has ended.
    expect(outcome).toEqual({ status: 'cancelled' });
    expect(repository.rows.size).toBe(0);
  });

  it('asks again while a required value is still missing', async () => {
    await collectorAt(NOW).start(
      invocationOf('mattermost', COMMAND_NAMES.createPage, ''),
      CREATE_PAGE_FIELDS,
    );

    const outcome = await collectorAt(NOW).resume(
      mentionAnswer('mattermost', '/memo/today'),
    );

    expect(outcome).toEqual({ status: 'pending' });
    expect(platform.postEphemeral).toHaveBeenCalledTimes(2);
    expect(repository.rows.size).toBe(1);
  });
});

describe('ArgumentCollector: the same field declaration collects on every service', () => {
  const runThrough = async (
    platformName: PlatformName,
    startArgs: string,
    withInteraction: boolean,
    answer: (collector: ArgumentCollector) => Promise<ResumeOutcome>,
  ) => {
    const repository = createFakeRepository();
    const platform = mock<ArgumentCollectorPlatform>();
    vi.mocked(platform.openModal).mockResolvedValue(true);
    vi.mocked(platform.postEphemeral).mockResolvedValue({
      ok: true,
      messageId: 'M1',
    });
    const deps = {
      pendingCollections: repository,
      platform,
      now: () => NOW,
      newCorrelationId: () => 'corr-1',
    };
    const invocation = invocationOf(
      platformName,
      COMMAND_NAMES.createPage,
      startArgs,
      withInteraction,
    );

    const started = await createArgumentCollector(deps).start(
      invocation,
      CREATE_PAGE_FIELDS,
    );
    expect(started.status).toBe('pending');

    // A different collector instance over the same storage: the answer may
    // reach another process than the one that asked (design.md 209-210).
    const last = await answer(createArgumentCollector(deps));
    return { last, invocation, repository };
  };

  it('collects the same values through a modal and through follow-up questions', async () => {
    const viaModal = await runThrough('slack', '', true, (collector) =>
      collector.resume(
        modalSubmit('slack', 'corr-1', {
          path: '/memo/today',
          body: 'first line\nsecond line',
        }),
      ),
    );

    const viaQuestions = await runThrough(
      'mattermost',
      '',
      false,
      async (collector) => {
        await collector.resume(mentionAnswer('mattermost', '/memo/today'));
        return collector.resume(
          mentionAnswer('mattermost', 'first line\nsecond line'),
        );
      },
    );

    const expectedValues = {
      path: '/memo/today',
      body: 'first line\nsecond line',
    };
    expect(viaModal.last).toEqual({
      status: 'collected',
      values: expectedValues,
      invocation: viaModal.invocation,
    });
    expect(viaQuestions.last).toEqual({
      status: 'collected',
      values: expectedValues,
      invocation: viaQuestions.invocation,
    });
    expect(viaModal.repository.rows.size).toBe(0);
    expect(viaQuestions.repository.rows.size).toBe(0);
  });
});

describe('ArgumentCollector.sweepExpired', () => {
  it('removes every collection past its deadline and answers how many', async () => {
    const repository = createFakeRepository();
    const platform = mock<ArgumentCollectorPlatform>();
    vi.mocked(platform.openModal).mockResolvedValue(true);
    vi.mocked(platform.postEphemeral).mockResolvedValue({
      ok: true,
      messageId: 'M1',
    });
    const collector = createArgumentCollector({
      pendingCollections: repository,
      platform,
      now: () => NOW,
      newCorrelationId: () => 'corr-1',
    });
    await collector.start(
      invocationOf('slack', COMMAND_NAMES.createPage, '', true),
      CREATE_PAGE_FIELDS,
    );

    const swept = await collector.sweepExpired(
      new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    );

    expect(swept).toBe(1);
    expect(repository.rows.size).toBe(0);
  });
});

describe('the field declaration this component is driven by', () => {
  it('is the one the command set declares, not a copy', () => {
    // Guards the acceptance test above from silently testing a private
    // fixture: both paths must be exercised with COMMAND_TRAITS' own list.
    const names = CREATE_PAGE_FIELDS.map((field: FieldSpec) => field.name);
    expect(names).toEqual(['path', 'body']);
  });
});

describe('ArgumentCollector.startGrowiChoice / resuming a GROWI choice', () => {
  let repository: ReturnType<typeof createFakeRepository>;
  let platform: ArgumentCollectorPlatform;

  const OPTIONS = [
    { relationId: 'rel-a', growiLabel: 'GROWI A' },
    { relationId: 'rel-b', growiLabel: 'GROWI B' },
  ];

  beforeEach(() => {
    repository = createFakeRepository();
    platform = mock<ArgumentCollectorPlatform>();
    vi.mocked(platform.postEphemeral).mockResolvedValue({
      ok: true,
      messageId: 'M1',
    });
  });

  const collector = () =>
    createArgumentCollector({
      pendingCollections: repository,
      platform,
      now: () => NOW,
      newCorrelationId: () => 'corr-choice',
    });

  const buttonPress = (
    platformName: PlatformName,
    correlationId: string,
    actionId: string,
  ): PlatformEvent => ({
    kind: 'action',
    platform: platformName,
    channel: channelOf(platformName),
    actor: actorOf(platformName),
    correlationId,
    actionId,
    // The rendered choice deliberately carries no `value` -- the option's own
    // id travels inside the action id (`platform/outbound.ts`).
    value: null,
    interaction: null,
  });

  it('offers the choice as buttons only this user sees, one per GROWI', async () => {
    const outcome = await collector().startGrowiChoice(
      invocationOf('slack', COMMAND_NAMES.createPage),
      { path: '/memo', body: 'text' },
      OPTIONS,
    );

    expect(outcome).toEqual({
      status: 'pending',
      correlationId: 'corr-choice',
    });
    const [, , message] = vi.mocked(platform.postEphemeral).mock.calls[0] ?? [];
    expect(message).toMatchObject({
      kind: 'choice',
      correlationId: 'corr-choice',
      options: [
        { id: 'rel-a', label: 'GROWI A' },
        { id: 'rel-b', label: 'GROWI B' },
      ],
    });
  });

  it('keeps the already-collected values with the row so pressing a button does not ask again', async () => {
    const invocation = invocationOf('slack', COMMAND_NAMES.createPage);
    await collector().startGrowiChoice(
      invocation,
      { path: '/memo', body: 'text' },
      OPTIONS,
    );

    const resumed = await collector().resume(
      buttonPress('slack', 'corr-choice', 'rel-b'),
    );

    expect(resumed).toEqual({
      status: 'growi-chosen',
      invocation,
      values: { path: '/memo', body: 'text' },
      relationId: 'rel-b',
    });
    expect(repository.rows.size).toBe(0);
  });

  it('refuses a pressed id that was never offered', async () => {
    // The offered list is the permission-filtered one. Accepting an id from
    // outside it would let a crafted press reach a GROWI this channel is not
    // allowed to use.
    await collector().startGrowiChoice(
      invocationOf('slack', COMMAND_NAMES.createPage),
      {},
      OPTIONS,
    );

    const resumed = await collector().resume(
      buttonPress('slack', 'corr-choice', 'rel-elsewhere'),
    );

    expect(resumed).toEqual({ status: 'not-mine' });
    expect(repository.rows.size).toBe(1);
  });

  it('accepts the numbered answer a service without buttons falls back to', async () => {
    const invocation = invocationOf('mattermost', COMMAND_NAMES.createPage);
    await collector().startGrowiChoice(invocation, { path: '/memo' }, OPTIONS);

    const resumed = await collector().resume(mentionAnswer('mattermost', '2'));

    expect(resumed).toMatchObject({
      status: 'growi-chosen',
      relationId: 'rel-b',
    });
  });

  it('asks again, rather than acting, when the typed answer names no option', async () => {
    await collector().startGrowiChoice(
      invocationOf('mattermost', COMMAND_NAMES.createPage),
      {},
      OPTIONS,
    );
    vi.mocked(platform.postEphemeral).mockClear();

    const resumed = await collector().resume(mentionAnswer('mattermost', '9'));

    expect(resumed).toEqual({ status: 'pending' });
    expect(repository.rows.size).toBe(1);
    expect(platform.postEphemeral).toHaveBeenCalledTimes(1);
  });

  it('drops the row when the choice could not be shown at all', async () => {
    vi.mocked(platform.postEphemeral).mockResolvedValue({
      ok: false,
      reason: 'bot-not-in-channel',
      remedy: 'invite the bot',
    });

    const outcome = await collector().startGrowiChoice(
      invocationOf('slack', COMMAND_NAMES.createPage),
      {},
      OPTIONS,
    );

    expect(outcome).toEqual({
      status: 'unavailable',
      reason: 'invite the bot',
    });
    expect(repository.rows.size).toBe(0);
  });

  it('leaves an ordinary field collection unaffected by the choice shape', async () => {
    // Both shapes share `collected`; the marker is what keeps them apart.
    await collector().start(
      invocationOf('slack', COMMAND_NAMES.createPage),
      CREATE_PAGE_FIELDS,
    );

    const resumed = await collector().resume(
      buttonPress('slack', 'corr-choice', 'rel-a'),
    );

    expect(resumed).toEqual({ status: 'not-mine' });
  });
});
