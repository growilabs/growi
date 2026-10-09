// The four branches design.md enumerates under 「GrowiSelector の判断」
// (Requirements 8.2 / 8.3 / 8.4 / 8.6), plus the one branch that must NOT
// behave like the other four: a posted URL that matches no linked GROWI stays
// silent (Requirement 6.4).
//
// **The permitted set is not decided here.** `@growi/chat`'s `judge` already
// owns it, and design.md says this component's `excluded` reasons are
// 「`filterBroadcastTargets` が返す `PermissionVerdict` の理由をそのまま持つ」.
// So these tests pin the two-sided default `judge` documents -- a command with
// no `channel_permission` row is DENIED when it writes and ALLOWED when it
// does not -- rather than a default this app invents for itself. A uniform
// default-deny here would be a second, disagreeing authorization rule.
//
// Every fixture goes through mocked Prisma delegates rather than a real
// database, the same way `relation-key-service.spec.ts` does: the selector
// builds its repositories from the `DbClient` it is handed, so mocking the
// delegates exercises the real repository code paths too.
import type { ChannelRef } from '@growi/chat';
import { type DeepMockProxy, mockDeep } from 'vitest-mock-extended';

import type { PrismaClient } from '../db/index.js';
import { createGrowiSelector } from './growi-selection.js';

const INSTALLATION = 'installation-1';

const CHANNEL: ChannelRef = {
  platform: 'slack',
  channelId: 'C-general',
  channelName: 'general',
  isPrivate: false,
};

const relationRow = (
  id: string,
  growiUri: string,
  growiLabel: string,
): {
  id: string;
  installationId: string;
  growiUri: string;
  growiLabel: string;
  searchWeight: number;
  settingsVersion: number;
  createdAt: Date;
} => ({
  id,
  installationId: INSTALLATION,
  growiUri,
  growiLabel,
  searchWeight: 1,
  settingsVersion: 1,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
});

const ALPHA = relationRow('rel-a', 'https://alpha.example.com/', 'Alpha');
const BRAVO = relationRow('rel-b', 'https://bravo.example.com/', 'Bravo');

/**
 * What `channel_permission` holds, per relation. A key that is absent stands
 * for "no row at all", which `judge` answers differently from an empty list
 * (an explicit restriction to zero channels).
 */
const withPermissions = (
  prisma: DeepMockProxy<PrismaClient>,
  permitted: Readonly<Record<string, ReadonlyArray<string> | 'all'>>,
): void => {
  prisma.channelPermission.findUnique.mockImplementation(((args: {
    where: { relationId_commandName: { relationId: string } };
  }) => {
    const { relationId } = args.where.relationId_commandName;
    const channels = permitted[relationId];
    if (channels == null) {
      return Promise.resolve(null);
    }
    // `'all'` lives in its own column, because an empty `channels` array
    // already means "no channel permitted". The row is written the way
    // `ChannelPermissionRepository.upsert` writes it.
    return Promise.resolve(
      channels === 'all'
        ? { channels: [], allowAll: true }
        : { channels: [...channels], allowAll: false },
    );
    // The mocked delegate's own parameter type is Prisma's generic
    // find-unique shape, which cannot be named outside `db/` (the architecture
    // guard forbids reaching into `src/generated/**`). Narrowed to the one
    // field the repository actually sends.
    // biome-ignore lint/suspicious/noExplicitAny: see above
  }) as any);
};

const selectorOver = (prisma: PrismaClient) =>
  createGrowiSelector({ db: prisma });

describe('exactly-one targeting (Requirements 8.2 / 8.3)', () => {
  it('asks the user to choose when several permitted GROWIs are linked (8.2)', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([
      BRAVO,
      ALPHA,
      relationRow('rel-c', 'https://charlie.example.com/', 'Charlie'),
    ]);
    withPermissions(prisma, {
      'rel-a': [CHANNEL.channelId],
      'rel-b': [CHANNEL.channelId],
      'rel-c': ['C-other'],
    });

    const outcome = await selectorOver(prisma).select({
      targeting: 'exactly-one',
      installationId: INSTALLATION,
      channel: CHANNEL,
      commandName: 'create-page',
    });

    expect(outcome.kind).toBe('choose');
    expect(
      outcome.kind === 'choose'
        ? outcome.options.map((r) => r.growiLabel)
        : null,
    ).toEqual(['Alpha', 'Bravo']);
    // Only the permitted GROWIs are offered, but the one held back is still
    // reported -- otherwise the user sees two choices where three GROWIs are
    // linked and has no way to know why the third is missing (Req 11.3).
    expect(outcome.kind === 'choose' ? outcome.excluded : null).toEqual([
      {
        relationId: 'rel-c',
        growiLabel: 'Charlie',
        reason: 'not-permitted-in-channel',
      },
    ]);
  });

  it('runs against the only permitted GROWI without asking (8.3)', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA, BRAVO]);
    withPermissions(prisma, {
      'rel-a': [CHANNEL.channelId],
      'rel-b': ['C-other'],
    });

    const outcome = await selectorOver(prisma).select({
      targeting: 'exactly-one',
      installationId: INSTALLATION,
      channel: CHANNEL,
      commandName: 'create-page',
    });

    expect(outcome).toEqual({
      kind: 'execute',
      targets: [expect.objectContaining({ relationId: 'rel-a' })],
      excluded: [
        {
          relationId: 'rel-b',
          growiLabel: 'Bravo',
          reason: 'not-permitted-in-channel',
        },
      ],
    });
  });

  it('breaks a tie between two identically-labelled GROWIs by relationId (8.2)', async () => {
    // Two GROWIs can share a label (nothing enforces uniqueness), so the sort
    // needs a second key or the offered order is free to disagree between two
    // otherwise-identical prompts.
    const first = relationRow('rel-x', 'https://x.example.com/', 'Same Name');
    const second = relationRow('rel-y', 'https://y.example.com/', 'Same Name');
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([second, first]);
    withPermissions(prisma, {
      'rel-x': [CHANNEL.channelId],
      'rel-y': [CHANNEL.channelId],
    });

    const outcome = await selectorOver(prisma).select({
      targeting: 'exactly-one',
      installationId: INSTALLATION,
      channel: CHANNEL,
      commandName: 'create-page',
    });

    expect(
      outcome.kind === 'choose'
        ? outcome.options.map((r) => r.relationId)
        : null,
    ).toEqual(['rel-x', 'rel-y']);
  });
});

describe('all-permitted targeting (Requirement 8.4)', () => {
  it('runs against every permitted GROWI without asking', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([BRAVO, ALPHA]);
    withPermissions(prisma, {
      'rel-a': [CHANNEL.channelId],
      'rel-b': [CHANNEL.channelId],
    });

    const outcome = await selectorOver(prisma).select({
      targeting: 'all-permitted',
      installationId: INSTALLATION,
      channel: CHANNEL,
      commandName: 'search',
    });

    expect(outcome.kind).toBe('execute');
    expect(
      outcome.kind === 'execute'
        ? outcome.targets.map((r) => r.growiLabel)
        : null,
    ).toEqual(['Alpha', 'Bravo']);
  });

  it('reports the GROWIs it left out, keeping the two reasons apart (11.3)', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([
      ALPHA,
      BRAVO,
      relationRow('rel-c', 'https://charlie.example.com/', 'Charlie'),
    ]);
    // `create-page` writes, so `rel-c`'s missing row is `no-settings` and
    // `rel-b`'s row that omits this channel is `not-permitted-in-channel` --
    // two different things to tell the user, never rolled into one.
    withPermissions(prisma, {
      'rel-a': [CHANNEL.channelId],
      'rel-b': ['C-other'],
    });

    const outcome = await selectorOver(prisma).select({
      targeting: 'all-permitted',
      installationId: INSTALLATION,
      channel: CHANNEL,
      commandName: 'create-page',
    });

    expect(outcome.kind === 'execute' ? outcome.excluded : null).toEqual([
      {
        relationId: 'rel-b',
        growiLabel: 'Bravo',
        reason: 'not-permitted-in-channel',
      },
      { relationId: 'rel-c', growiLabel: 'Charlie', reason: 'no-settings' },
    ]);
  });
});

// The rule this app must not restate for itself: `judge` denies a missing row
// only for commands that WRITE. Getting this backwards in either direction is
// invisible until it matters -- default-deny silently makes `search` useless
// on a freshly paired GROWI, default-allow silently lets `create-page`
// through from a channel nobody permitted.
describe('a missing channel_permission row (the shared default)', () => {
  it('still runs a non-write command against every linked GROWI', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA, BRAVO]);
    withPermissions(prisma, {});

    const outcome = await selectorOver(prisma).select({
      targeting: 'all-permitted',
      installationId: INSTALLATION,
      channel: CHANNEL,
      commandName: 'search',
    });

    expect(outcome).toEqual({
      kind: 'execute',
      targets: [
        expect.objectContaining({ relationId: 'rel-a' }),
        expect.objectContaining({ relationId: 'rel-b' }),
      ],
      excluded: [],
    });
  });

  it('refuses a write command, because nobody has permitted it yet', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA]);
    withPermissions(prisma, {});

    const outcome = await selectorOver(prisma).select({
      targeting: 'exactly-one',
      installationId: INSTALLATION,
      channel: CHANNEL,
      commandName: 'keep',
    });

    expect(outcome).toEqual({
      kind: 'explain',
      reason: 'not-permitted',
      excluded: [
        { relationId: 'rel-a', growiLabel: 'Alpha', reason: 'no-settings' },
      ],
    });
  });
});

describe('nothing to run against (Requirements 8.6 / 11.3)', () => {
  it('explains that no GROWI is linked at all', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([]);

    const outcome = await selectorOver(prisma).select({
      targeting: 'exactly-one',
      installationId: INSTALLATION,
      channel: CHANNEL,
      commandName: 'create-page',
    });

    expect(outcome).toEqual({
      kind: 'explain',
      reason: 'not-linked',
      excluded: [],
    });
  });

  it('explains that every linked GROWI is barred from this channel', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA, BRAVO]);
    withPermissions(prisma, { 'rel-a': ['C-other'] });

    const outcome = await selectorOver(prisma).select({
      targeting: 'all-permitted',
      installationId: INSTALLATION,
      channel: CHANNEL,
      commandName: 'create-page',
    });

    expect(outcome).toEqual({
      kind: 'explain',
      reason: 'not-permitted',
      excluded: [
        {
          relationId: 'rel-a',
          growiLabel: 'Alpha',
          reason: 'not-permitted-in-channel',
        },
        { relationId: 'rel-b', growiLabel: 'Bravo', reason: 'no-settings' },
      ],
    });
  });

  it('treats an explicitly empty channel list as "not permitted in this channel"', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA]);
    withPermissions(prisma, { 'rel-a': [] });

    const outcome = await selectorOver(prisma).select({
      targeting: 'exactly-one',
      installationId: INSTALLATION,
      channel: CHANNEL,
      commandName: 'keep',
    });

    expect(outcome).toEqual({
      kind: 'explain',
      reason: 'not-permitted',
      excluded: [
        {
          relationId: 'rel-a',
          growiLabel: 'Alpha',
          reason: 'not-permitted-in-channel',
        },
      ],
    });
  });
});

describe('all-paired-no-filter targeting (link)', () => {
  it('offers every paired GROWI without consulting channel_permission', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([BRAVO, ALPHA]);

    const outcome = await selectorOver(prisma).select({
      targeting: 'all-paired-no-filter',
      installationId: INSTALLATION,
    });

    expect(outcome.kind).toBe('choose');
    expect(
      outcome.kind === 'choose'
        ? outcome.options.map((r) => r.growiLabel)
        : null,
    ).toEqual(['Alpha', 'Bravo']);
    // design.md: 「後から `channel_permission` に `link` の行を作らないこと」 --
    // the invariant is that the table is not even read here.
    expect(prisma.channelPermission.findUnique).not.toHaveBeenCalled();
  });

  it('still offers a choice when exactly one GROWI is paired', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA]);

    const outcome = await selectorOver(prisma).select({
      targeting: 'all-paired-no-filter',
      installationId: INSTALLATION,
    });

    expect(outcome.kind).toBe('choose');
  });

  it('explains when nothing is paired', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([]);

    const outcome = await selectorOver(prisma).select({
      targeting: 'all-paired-no-filter',
      installationId: INSTALLATION,
    });

    expect(outcome).toEqual({
      kind: 'explain',
      reason: 'not-linked',
      excluded: [],
    });
  });
});

describe('url-match targeting (Requirement 6.4)', () => {
  const byUrl = (prisma: PrismaClient, url: string) =>
    selectorOver(prisma).select({
      targeting: 'url-match',
      installationId: INSTALLATION,
      channel: CHANNEL,
      commandName: 'link-preview',
      url,
    });

  it('picks the single GROWI whose URI the posted URL sits under', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA, BRAVO]);
    withPermissions(prisma, {
      'rel-a': [CHANNEL.channelId],
      'rel-b': [CHANNEL.channelId],
    });

    const outcome = await byUrl(prisma, 'https://bravo.example.com/Sandbox');

    expect(outcome.kind).toBe('execute');
    expect(
      outcome.kind === 'execute'
        ? outcome.targets.map((r) => r.relationId)
        : null,
    ).toEqual(['rel-b']);
  });

  it('says nothing at all when the URL belongs to no linked GROWI (6.4)', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA, BRAVO]);
    withPermissions(prisma, {
      'rel-a': [CHANNEL.channelId],
      'rel-b': [CHANNEL.channelId],
    });

    const outcome = await byUrl(
      prisma,
      'https://elsewhere.example.com/Sandbox',
    );

    expect(outcome).toEqual({ kind: 'silent' });
  });

  it('says nothing when the workspace has no linked GROWI at all (6.4)', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([]);

    const outcome = await byUrl(prisma, 'https://alpha.example.com/Sandbox');

    expect(outcome).toEqual({ kind: 'silent' });
  });

  it('says nothing when the posted text is not a URL at all (6.4)', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA]);
    withPermissions(prisma, { 'rel-a': [CHANNEL.channelId] });

    const outcome = await byUrl(prisma, 'not a url');

    expect(outcome).toEqual({ kind: 'silent' });
  });

  it('honours the base path of a GROWI served under a prefix', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([
      relationRow('rel-p', 'https://example.com/growi/', 'Prefixed'),
    ]);
    withPermissions(prisma, { 'rel-p': [CHANNEL.channelId] });

    expect(
      (await byUrl(prisma, 'https://example.com/growi/Sandbox')).kind,
    ).toBe('execute');
    expect(
      (await byUrl(prisma, 'https://example.com/other/Sandbox')).kind,
    ).toBe('silent');
    // A neighbour whose path merely starts with the same letters is a
    // different GROWI, not a page under this one.
    expect((await byUrl(prisma, 'https://example.com/growix/Page')).kind).toBe(
      'silent',
    );
    // The GROWI's own front door, pasted bare. This is the likeliest URL of
    // all to be shared, and the stored URI's trailing `/` must not be what
    // decides whether it is recognised.
    expect((await byUrl(prisma, 'https://example.com/growi')).kind).toBe(
      'execute',
    );
  });

  it('prefers the most specific base path when two GROWIs share a host', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([
      relationRow('rel-root', 'https://example.com/', 'Root'),
      relationRow('rel-deep', 'https://example.com/team/', 'Team'),
    ]);
    withPermissions(prisma, {
      'rel-root': [CHANNEL.channelId],
      'rel-deep': [CHANNEL.channelId],
    });

    const outcome = await byUrl(prisma, 'https://example.com/team/Sandbox');

    expect(
      outcome.kind === 'execute'
        ? outcome.targets.map((r) => r.relationId)
        : null,
    ).toEqual(['rel-deep']);
  });

  it('ignores a default port written out in either place', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([
      relationRow('rel-a', 'https://alpha.example.com', 'Alpha'),
    ]);
    withPermissions(prisma, { 'rel-a': [CHANNEL.channelId] });

    expect(
      (await byUrl(prisma, 'https://alpha.example.com:443/Sandbox')).kind,
    ).toBe('execute');
  });

  it('explains, rather than staying silent, when the matched GROWI is barred from this channel (11.3)', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA]);
    withPermissions(prisma, { 'rel-a': ['C-other'] });

    const outcome = await byUrl(prisma, 'https://alpha.example.com/Sandbox');

    expect(outcome).toEqual({
      kind: 'explain',
      reason: 'not-permitted',
      excluded: [
        {
          relationId: 'rel-a',
          growiLabel: 'Alpha',
          reason: 'not-permitted-in-channel',
        },
      ],
    });
  });
});

describe("a row that permits every channel ('all')", () => {
  it('selects the GROWI for a WRITE command from a channel the row does not list', async () => {
    // The one thing task 5.3's hand-off (a) warned about, read from this end.
    // `RelationSettings.allowedChannels` has three values and `channels`
    // alone can carry two, so `'all'` is stored in its own column -- and if
    // the store had folded it into an empty list, this exact call would come
    // back `not-permitted-in-channel`. Deleting the row instead would answer
    // `no-settings`, which `judge()` turns into a denial for `create-page`.
    // Both wrong answers are the OPPOSITE of what was configured, and a write
    // command from a channel the row does not list is where they show.
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA]);
    withPermissions(prisma, { 'rel-a': 'all' });

    const outcome = await selectorOver(prisma).select({
      targeting: 'exactly-one',
      installationId: INSTALLATION,
      channel: CHANNEL,
      commandName: 'create-page',
    });

    expect(outcome).toEqual({
      kind: 'execute',
      targets: [expect.objectContaining({ relationId: 'rel-a' })],
      excluded: [],
    });
  });
});
