// Task 3.6: 「チャンネルの一覧を取り直す関数を用意する」.
//
// Two contracts are asserted here, and they are independent:
//
//  1. **What `refreshChannelInventory` writes, and when.** The write timing is
//     the security-relevant half (design.md 「通知の宛先の検査」): a refresh
//     that fails must leave BOTH the saved inventory and `channels_synced_at`
//     exactly as they were, so 「一度も取れていない」 keeps answering
//     `inventory-not-ready` instead of the misleading
//     `channel-not-in-installation`.
//  2. **What each service's channel listing produces.** Asserted through an
//     injected `fetch` against the shape each service's real API returns, so
//     the mapping into `ChannelInventory` (name, privacy, which channel kinds
//     count at all) is checked rather than the SDK helper that carries it.
import type { ChannelInventory, PlatformName } from '@growi/chat';
import { mock } from 'vitest-mock-extended';

import type {
  InstallationChannelRecord,
  InstallationChannelRepository,
  InstallationRepository,
} from '../db/index.js';
import type {
  InstallationCredentials,
  PlatformAppConfig,
} from '../types/index.js';
import {
  CHANNEL_LISTERS,
  type ChannelLister,
  type ChannelListerContext,
  type ChannelRefreshDeps,
  listChannels,
  refreshChannelInventory,
} from './channels.js';

// --------------------------------------------------------------------------
// refreshChannelInventory
// --------------------------------------------------------------------------

const INSTALLATION_ID = 'inst-1';
const NOW = new Date('2026-09-03T10:00:00.000Z');

const channelOf = (
  channelId: string,
  overrides: Partial<ChannelInventory['channels'][number]> = {},
) => ({
  platform: 'slack' as PlatformName,
  channelId,
  channelName: channelId.replace('C', 'ch-'),
  isPrivate: false,
  ...overrides,
});

interface RefreshHarness {
  readonly deps: ChannelRefreshDeps;
  readonly upserted: InstallationChannelRecord[];
  readonly synced: Array<{ installationId: string; syncedAt: Date }>;
}

const refreshHarness = (
  listChannelsImpl: (installationId: string) => Promise<ChannelInventory>,
): RefreshHarness => {
  const upserted: InstallationChannelRecord[] = [];
  const synced: Array<{ installationId: string; syncedAt: Date }> = [];

  const channels = mock<InstallationChannelRepository>({
    upsert: (record) => {
      upserted.push(record);
      return Promise.resolve();
    },
  });
  const installations = mock<InstallationRepository>({
    markChannelsSynced: (installationId, syncedAt) => {
      synced.push({ installationId, syncedAt });
      return Promise.resolve();
    },
  });

  return {
    deps: {
      listChannels: listChannelsImpl,
      channels,
      installations,
      now: () => NOW,
    },
    upserted,
    synced,
  };
};

describe('refreshChannelInventory', () => {
  it('saves every channel it was given and marks the installation synced', async () => {
    const harness = refreshHarness(async () => ({
      channels: [
        channelOf('C1'),
        channelOf('C2', { isPrivate: true, channelName: 'secret' }),
      ],
    }));

    await refreshChannelInventory(harness.deps, INSTALLATION_ID);

    expect(harness.upserted).toEqual([
      {
        installationId: INSTALLATION_ID,
        platform: 'slack',
        channelId: 'C1',
        channelName: 'ch-1',
        isPrivate: false,
        refreshedAt: NOW,
      },
      {
        installationId: INSTALLATION_ID,
        platform: 'slack',
        channelId: 'C2',
        channelName: 'secret',
        isPrivate: true,
        refreshedAt: NOW,
      },
    ]);
    expect(harness.synced).toEqual([
      { installationId: INSTALLATION_ID, syncedAt: NOW },
    ]);
  });

  it('marks the installation synced even when the service reported no channels', async () => {
    // design.md: 「`channels_synced_at` は…結果によらず（0 件でも）完了するたびに
    // 現在時刻を書く」. Without this write, an installation whose workspace
    // genuinely has no usable channel would stay indistinguishable from one
    // that was never refreshed at all.
    const harness = refreshHarness(() => Promise.resolve({ channels: [] }));

    await refreshChannelInventory(harness.deps, INSTALLATION_ID);

    expect(harness.upserted).toEqual([]);
    expect(harness.synced).toEqual([
      { installationId: INSTALLATION_ID, syncedAt: NOW },
    ]);
  });

  it('writes nothing at all when the listing fails, and reports the failure', async () => {
    // design.md's failure path: 「取り直しの失敗 | 最後に取れた一覧をそのまま
    // 使い続ける」. Both writes must be skipped -- marking the installation
    // synced after a failed listing would turn a never-synced installation
    // into an empty-but-synced one, which answers
    // `channel-not-in-installation` and sends the operator to re-create a
    // channel that was never the problem.
    const failure = new Error('conversations.list failed');
    const harness = refreshHarness(() => Promise.reject(failure));

    await expect(
      refreshChannelInventory(harness.deps, INSTALLATION_ID),
    ).rejects.toBe(failure);

    expect(harness.upserted).toEqual([]);
    expect(harness.synced).toEqual([]);
  });

  it('stamps every row and the sync marker with one single timestamp', async () => {
    const harness = refreshHarness(async () => ({
      channels: [channelOf('C1'), channelOf('C2')],
    }));

    await refreshChannelInventory(harness.deps, INSTALLATION_ID);

    const stamps = new Set([
      ...harness.upserted.map((row) => row.refreshedAt.getTime()),
      ...harness.synced.map((entry) => entry.syncedAt.getTime()),
    ]);
    expect(stamps.size).toBe(1);
  });
});

// --------------------------------------------------------------------------
// listChannels -- dispatch
// --------------------------------------------------------------------------

const CONTEXT: ChannelListerContext = {
  workspaceId: 'T123',
  credentials: {},
  appConfig: { stateConnectionString: 'postgres://unused' },
  fetch: async () => new Response('{}'),
};

describe('listChannels', () => {
  it('asks the lister declared for the platform, and nothing else', async () => {
    const called: PlatformName[] = [];
    const listerFor =
      (platform: PlatformName): ChannelLister =>
      () => {
        called.push(platform);
        return Promise.resolve([
          { platform, channelId: 'X', channelName: 'x', isPrivate: false },
        ]);
      };
    const listers: Readonly<Record<PlatformName, ChannelLister>> = {
      slack: listerFor('slack'),
      discord: listerFor('discord'),
      teams: listerFor('teams'),
      mattermost: listerFor('mattermost'),
    };

    const inventory = await listChannels('discord', CONTEXT, listers);

    expect(called).toEqual(['discord']);
    expect(inventory).toEqual({
      channels: [
        {
          platform: 'discord',
          channelId: 'X',
          channelName: 'x',
          isPrivate: false,
        },
      ],
    });
  });

  it('declares a lister for every service', () => {
    expect(Object.keys(CHANNEL_LISTERS).sort()).toEqual([
      'discord',
      'mattermost',
      'slack',
      'teams',
    ]);
  });
});

// --------------------------------------------------------------------------
// The four listers
// --------------------------------------------------------------------------

/**
 * A `fetch` that answers each call from a queued body and records the request.
 * Preferred over a module mock because two of the four services are called
 * over plain HTTP: injecting `fetch` is the only seam all four share.
 */
const fetchStub = (bodies: ReadonlyArray<unknown | Error>) => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  let call = 0;

  const stub: typeof fetch = (input, init) => {
    requests.push({
      url: input instanceof URL ? input.toString() : String(input),
      ...(init == null ? {} : { init }),
    });
    const body = bodies[call];
    call += 1;
    if (body === undefined) {
      return Promise.reject(new Error(`unexpected fetch call ${call}`));
    }
    if (body instanceof Error) return Promise.reject(body);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  };

  return { stub, requests };
};

const contextOf = (
  overrides: Partial<ChannelListerContext>,
): ChannelListerContext => ({ ...CONTEXT, ...overrides });

describe('CHANNEL_LISTERS.slack', () => {
  const credentials: InstallationCredentials = {
    slack: { botToken: 'xoxb-1' },
  };

  it('walks conversations.list and maps public and private channels', async () => {
    const { stub, requests } = fetchStub([
      {
        ok: true,
        channels: [
          { id: 'C1', name: 'general', is_private: false },
          { id: 'C2', name: 'secret', is_private: true },
        ],
        response_metadata: { next_cursor: 'page2' },
      },
      {
        ok: true,
        channels: [{ id: 'C3', name: 'random', is_private: false }],
        response_metadata: { next_cursor: '' },
      },
    ]);

    const channels = await CHANNEL_LISTERS.slack(
      contextOf({ credentials, fetch: stub }),
    );

    expect(channels).toEqual([
      {
        platform: 'slack',
        channelId: 'C1',
        channelName: 'general',
        isPrivate: false,
      },
      {
        platform: 'slack',
        channelId: 'C2',
        channelName: 'secret',
        isPrivate: true,
      },
      {
        platform: 'slack',
        channelId: 'C3',
        channelName: 'random',
        isPrivate: false,
      },
    ]);
    expect(requests).toHaveLength(2);
    // `team_id` is required for an Enterprise Grid org-wide token, and Slack
    // documents it as ignored elsewhere -- without it the listing silently
    // spans the wrong workspaces.
    expect(String(requests[0]?.init?.body)).toContain('team_id=T123');
    expect(String(requests[1]?.init?.body)).toContain('cursor=page2');
  });

  it('fails rather than answering an empty list when Slack refuses the call', async () => {
    // `callSlackApi` resolves HTTP 200 with `{ok:false}` -- Slack's own way of
    // reporting a missing scope. Reading that as "this workspace has no
    // channels" would mark the installation synced and empty, so every
    // notification would be refused as `channel-not-in-installation`.
    const { stub } = fetchStub([{ ok: false, error: 'missing_scope' }]);

    await expect(
      CHANNEL_LISTERS.slack(contextOf({ credentials, fetch: stub })),
    ).rejects.toThrow(/missing_scope/);
  });

  it('propagates a mid-pagination failure instead of returning the pages it already had', async () => {
    // The whole listing resolves or it throws: `refreshChannelInventory` only
    // starts writing once it has the complete inventory, so a half-walked
    // listing must never reach it.
    const { stub } = fetchStub([
      {
        ok: true,
        channels: [{ id: 'C1', name: 'general', is_private: false }],
        response_metadata: { next_cursor: 'page2' },
      },
      new Error('connection reset'),
    ]);

    await expect(
      CHANNEL_LISTERS.slack(contextOf({ credentials, fetch: stub })),
    ).rejects.toThrow('connection reset');
  });

  it('fails rather than truncating when the workspace has more pages than the bound', async () => {
    // A truncated inventory is indistinguishable from a smaller workspace once
    // saved, so every channel past the bound would be refused as
    // `channel-not-in-installation` with nothing to show it was cut off.
    const endlessPage = {
      ok: true,
      channels: [{ id: 'C1', name: 'general', is_private: false }],
      response_metadata: { next_cursor: 'more' },
    };
    const { stub } = fetchStub(new Array(200).fill(endlessPage));

    await expect(
      CHANNEL_LISTERS.slack(contextOf({ credentials, fetch: stub })),
    ).rejects.toThrow(/truncated/i);
  });

  it('fails when the installation carries no Slack credentials', async () => {
    await expect(
      CHANNEL_LISTERS.slack(contextOf({ credentials: {} })),
    ).rejects.toThrow(/credential/i);
  });
});

describe('CHANNEL_LISTERS.discord', () => {
  const appConfig: PlatformAppConfig = {
    ...CONTEXT.appConfig,
    discord: {
      applicationId: 'app-1',
      publicKey: 'pk',
      clientSecret: 'cs',
      botToken: 'bot-1',
    },
  };

  it('lists the guild text channels and reads privacy from the @everyone overwrite', async () => {
    const { stub, requests } = fetchStub([
      [
        { id: '1', name: 'general', type: 0 },
        { id: '2', name: 'announce', type: 5 },
        // Voice channel: not a notification target.
        { id: '3', name: 'lounge', type: 2 },
        {
          id: '4',
          name: 'staff',
          type: 0,
          // `@everyone`'s role id equals the guild id, and 1 << 10 is
          // VIEW_CHANNEL -- denying it there is what makes a Discord channel
          // private.
          permission_overwrites: [
            { id: 'G1', type: 0, allow: '0', deny: String(1 << 10) },
          ],
        },
      ],
    ]);

    const channels = await CHANNEL_LISTERS.discord(
      contextOf({ workspaceId: 'G1', appConfig, fetch: stub }),
    );

    expect(channels).toEqual([
      {
        platform: 'discord',
        channelId: '1',
        channelName: 'general',
        isPrivate: false,
      },
      {
        platform: 'discord',
        channelId: '2',
        channelName: 'announce',
        isPrivate: false,
      },
      {
        platform: 'discord',
        channelId: '4',
        channelName: 'staff',
        isPrivate: true,
      },
    ]);
    expect(requests[0]?.url).toContain('/guilds/G1/channels');
  });

  it('fails when the response is not a success', async () => {
    const stub: typeof fetch = async () =>
      new Response('{"message":"Missing Access"}', { status: 403 });

    await expect(
      CHANNEL_LISTERS.discord(
        contextOf({ workspaceId: 'G1', appConfig, fetch: stub }),
      ),
    ).rejects.toThrow(/403/);
  });

  it('fails when this deployment configures no Discord app', async () => {
    await expect(
      CHANNEL_LISTERS.discord(contextOf({ workspaceId: 'G1' })),
    ).rejects.toThrow(/credential/i);
  });
});

describe('CHANNEL_LISTERS.mattermost', () => {
  const credentials: InstallationCredentials = {
    mattermost: { baseUrl: 'https://mm.example.com', botToken: 'mm-1' },
  };

  // The bot's own team membership only decides which teams get walked at all
  // (there is no way to list teams the bot is not in via a bot token). Within
  // a team, the inventory must answer 「その workspace のチャンネルか」, not
  // 「bot が入っているチャンネルか」 -- so each team is asked for its public
  // channels (workspace-wide, regardless of bot membership) union its
  // bot-joined channels (the only way to see a private one).
  it("answers with the union of a team's public channels and the channels the bot has joined, and keeps only open and private types", async () => {
    const { stub, requests } = fetchStub([
      [{ id: 'team-1' }, { id: 'team-2' }],
      // Team 1's public channels -- includes ch-1, which the bot has NOT
      // joined.
      [
        {
          id: 'ch-1',
          name: 'town-square',
          display_name: 'Town Square',
          type: 'O',
        },
      ],
      // Team 1's bot-joined channels -- ch-2 is a private channel only
      // reachable this way; ch-3/ch-4 are a DM and a group message, not
      // channels an administrator can pick as a notification target.
      [
        { id: 'ch-2', name: 'ops', display_name: 'Ops', type: 'P' },
        { id: 'ch-3', name: 'dm', display_name: '', type: 'D' },
        { id: 'ch-4', name: 'gm', display_name: '', type: 'G' },
      ],
      // Team 2's public channels.
      [{ id: 'ch-5', name: 'second', display_name: 'Second', type: 'O' }],
      // Team 2's bot-joined channels -- empty.
      [],
    ]);

    const channels = await CHANNEL_LISTERS.mattermost(
      contextOf({ credentials, fetch: stub }),
    );

    expect(channels).toEqual([
      {
        platform: 'mattermost',
        channelId: 'ch-1',
        channelName: 'Town Square',
        isPrivate: false,
      },
      {
        platform: 'mattermost',
        channelId: 'ch-2',
        channelName: 'Ops',
        isPrivate: true,
      },
      {
        platform: 'mattermost',
        channelId: 'ch-5',
        channelName: 'Second',
        isPrivate: false,
      },
    ]);
    expect(requests[0]?.url).toBe(
      'https://mm.example.com/api/v4/users/me/teams',
    );
    expect(requests[1]?.url).toBe(
      'https://mm.example.com/api/v4/teams/team-1/channels?page=0&per_page=200',
    );
    expect(requests[2]?.url).toBe(
      'https://mm.example.com/api/v4/users/me/teams/team-1/channels',
    );
    expect(requests[3]?.url).toBe(
      'https://mm.example.com/api/v4/teams/team-2/channels?page=0&per_page=200',
    );
    expect(requests[4]?.url).toBe(
      'https://mm.example.com/api/v4/users/me/teams/team-2/channels',
    );
  });

  // Regression test for the bug round 1 shipped: a public channel the bot has
  // not joined used to be missing entirely from the inventory, because the
  // lister only ever asked the bot-joined-channels endpoint. If this
  // assertion ever starts failing, that bug is back.
  it('includes a public channel the bot has not joined', async () => {
    const { stub, requests } = fetchStub([
      [{ id: 'team-1' }],
      [
        {
          id: 'ch-not-joined',
          name: 'general',
          display_name: 'General',
          type: 'O',
        },
      ],
      // The bot-joined-channels response does not carry this channel at all.
      [],
    ]);

    const channels = await CHANNEL_LISTERS.mattermost(
      contextOf({ credentials, fetch: stub }),
    );

    expect(channels).toEqual([
      {
        platform: 'mattermost',
        channelId: 'ch-not-joined',
        channelName: 'General',
        isPrivate: false,
      },
    ]);
    // Pin down that this result came from the PUBLIC-channels endpoint, not
    // only the bot-joined one -- otherwise a stub that merely answers calls in
    // order can happen to produce this same result even from a lister that
    // dropped the public-channels call entirely (the bug round 1 shipped).
    expect(requests[0]?.url).toBe(
      'https://mm.example.com/api/v4/users/me/teams',
    );
    expect(requests[1]?.url).toBe(
      'https://mm.example.com/api/v4/teams/team-1/channels?page=0&per_page=200',
    );
    expect(requests[2]?.url).toBe(
      'https://mm.example.com/api/v4/users/me/teams/team-1/channels',
    );
  });

  it('lists a channel once when it appears in both the public and bot-joined responses', async () => {
    const { stub, requests } = fetchStub([
      [{ id: 'team-1' }],
      [
        {
          id: 'ch-1',
          name: 'town-square',
          display_name: 'Town Square',
          type: 'O',
        },
      ],
      [
        {
          id: 'ch-1',
          name: 'town-square',
          display_name: 'Town Square',
          type: 'O',
        },
      ],
    ]);

    const channels = await CHANNEL_LISTERS.mattermost(
      contextOf({ credentials, fetch: stub }),
    );

    expect(channels).toEqual([
      {
        platform: 'mattermost',
        channelId: 'ch-1',
        channelName: 'Town Square',
        isPrivate: false,
      },
    ]);
    // Confirm the single result really is a merge of two separate responses
    // (public-channels and bot-joined-channels), not just the bot-joined call
    // alone -- otherwise a lister that skips the public-channels call could
    // pass this de-duplication test for the wrong reason.
    expect(requests[0]?.url).toBe(
      'https://mm.example.com/api/v4/users/me/teams',
    );
    expect(requests[1]?.url).toBe(
      'https://mm.example.com/api/v4/teams/team-1/channels?page=0&per_page=200',
    );
    expect(requests[2]?.url).toBe(
      'https://mm.example.com/api/v4/users/me/teams/team-1/channels',
    );
  });

  // Round 4 regression test: `GET /teams/{team_id}/channels` (the public
  // channel listing) is itself paginated by Mattermost -- sending no
  // `page`/`per_page` at all, as this lister used to, silently returns only
  // the team's first page of public channels. A team with more public
  // channels than one page would have channel #(pageSize + 1) onward missing
  // from the inventory entirely, with nothing to show it was cut off.
  it("walks every page of a team's public channels", async () => {
    const page0 = Array.from({ length: 200 }, (_, i) => ({
      id: `ch-${i}`,
      name: `channel-${i}`,
      display_name: `Channel ${i}`,
      type: 'O',
    }));
    const page1 = [
      {
        id: 'ch-200',
        name: 'channel-200',
        display_name: 'Channel 200',
        type: 'O',
      },
      {
        id: 'ch-201',
        name: 'channel-201',
        display_name: 'Channel 201',
        type: 'O',
      },
    ];
    const { stub, requests } = fetchStub([
      [{ id: 'team-1' }],
      page0,
      page1,
      // Bot-joined channels for team-1 -- empty; this test is only about the
      // public-channels pagination.
      [],
    ]);

    const channels = await CHANNEL_LISTERS.mattermost(
      contextOf({ credentials, fetch: stub }),
    );

    expect(channels).toHaveLength(202);
    expect(channels.map((channel) => channel.channelId)).toEqual([
      ...page0.map((row) => row.id),
      ...page1.map((row) => row.id),
    ]);
    // Pin down that BOTH pages were actually requested with the expected
    // page/per_page parameters, rather than trusting the result count alone
    // (round 3 established this pattern after a queue-driven stub was found
    // able to produce a passing count from the wrong call sequence).
    expect(requests[0]?.url).toBe(
      'https://mm.example.com/api/v4/users/me/teams',
    );
    expect(requests[1]?.url).toBe(
      'https://mm.example.com/api/v4/teams/team-1/channels?page=0&per_page=200',
    );
    expect(requests[2]?.url).toBe(
      'https://mm.example.com/api/v4/teams/team-1/channels?page=1&per_page=200',
    );
    expect(requests[3]?.url).toBe(
      'https://mm.example.com/api/v4/users/me/teams/team-1/channels',
    );
  });

  it('falls back to the url name when a channel has no display name', async () => {
    const { stub } = fetchStub([
      [{ id: 'team-1' }],
      [{ id: 'ch-1', name: 'town-square', display_name: '', type: 'O' }],
      [],
    ]);

    const channels = await CHANNEL_LISTERS.mattermost(
      contextOf({ credentials, fetch: stub }),
    );

    expect(channels[0]?.channelName).toBe('town-square');
  });

  it('fails when the installation carries no Mattermost credentials', async () => {
    await expect(
      CHANNEL_LISTERS.mattermost(contextOf({ credentials: {} })),
    ).rejects.toThrow(/credential/i);
  });
});

describe('CHANNEL_LISTERS.teams', () => {
  const appConfig: PlatformAppConfig = {
    ...CONTEXT.appConfig,
    teams: { clientId: 'app-1', clientSecret: 'secret' },
  };
  const credentials: InstallationCredentials = {
    teams: { tenantId: 'tenant-1' },
  };

  /** Graph is reached with a bearer token the helper acquires first. */
  const TOKEN_RESPONSE = { access_token: 'graph-token', expires_in: 3600 };

  it('lists every team in the tenant and the channels of each', async () => {
    const { stub, requests } = fetchStub([
      TOKEN_RESPONSE,
      {
        value: [{ id: 'team-1' }],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/teams?$skip=1',
      },
      TOKEN_RESPONSE,
      { value: [{ id: 'team-2' }] },
      TOKEN_RESPONSE,
      {
        value: [
          { id: 'ch-1', displayName: 'General', membershipType: 'standard' },
          { id: 'ch-2', displayName: 'Leads', membershipType: 'private' },
        ],
      },
      TOKEN_RESPONSE,
      {
        value: [{ id: 'ch-3', displayName: 'Other', membershipType: 'shared' }],
      },
    ]);

    const channels = await CHANNEL_LISTERS.teams(
      contextOf({
        workspaceId: 'tenant-1',
        appConfig,
        credentials,
        fetch: stub,
      }),
    );

    expect(channels).toEqual([
      {
        platform: 'teams',
        channelId: 'ch-1',
        channelName: 'General',
        isPrivate: false,
      },
      {
        platform: 'teams',
        channelId: 'ch-2',
        channelName: 'Leads',
        isPrivate: true,
      },
      {
        platform: 'teams',
        channelId: 'ch-3',
        channelName: 'Other',
        isPrivate: false,
      },
    ]);
    // Asserted as the exact ordered sequence, not as membership: the Graph
    // helper acquires a fresh bearer token before EVERY call (it caches
    // nothing), so a queue-driven stub that merely "contains" the right URLs
    // could still be answering each request from the wrong queue slot.
    expect(requests.map((request) => request.url)).toEqual([
      'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token',
      'https://graph.microsoft.com/v1.0/teams',
      'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token',
      'https://graph.microsoft.com/v1.0/teams?$skip=1',
      'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token',
      'https://graph.microsoft.com/v1.0/teams/team-1/channels',
      'https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token',
      'https://graph.microsoft.com/v1.0/teams/team-2/channels',
    ]);
  });

  it('fails when the app or the installation carries no Teams credentials', async () => {
    await expect(
      CHANNEL_LISTERS.teams(contextOf({ credentials })),
    ).rejects.toThrow(/credential/i);
    await expect(
      CHANNEL_LISTERS.teams(contextOf({ appConfig })),
    ).rejects.toThrow(/credential/i);
  });
});
