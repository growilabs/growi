// What these tests hold down is the one thing `ADMIN_CHECK_TABLE`
// (`capabilities/admin-check.ts`) declares but does not do: actually asking
// each service which roles the person who typed the command holds.
//
// Three properties shape every test below:
//
//  1. **「読めなかった」と「読めたが管理者ではない」は別物.** `null` and
//     `grantedFields: []` are asserted separately per service, because
//     `AdminFlow` shows a different message for each -- one sends the operator
//     to this proxy's configuration, the other to their own workspace's
//     settings. A failure that collapsed into `[]` would send them to the
//     wrong place.
//  2. **The answer is read through the declared table, not through a service
//     name.** Every granted field asserted here is a value that appears in
//     `ADMIN_CHECK_TABLE`, so a reader that invented its own vocabulary would
//     produce fields `isWorkspaceAdmin` never matches.
//  3. **No live service.** Every reader takes its `fetch` from the context,
//     the same seam `channels.ts` uses.
import { describe, expect, it, vi } from 'vitest';

import { ADMIN_CHECK_TABLE } from '../capabilities/index.js';
import type {
  InstallationCredentials,
  PlatformAppConfig,
} from '../types/index.js';
import {
  type ActorRoleContext,
  type ActorRoleReader,
  observeActorRoles,
  ROLE_READERS,
} from './actor-roles.js';

const channel = {
  platform: 'slack' as const,
  channelId: 'C1',
  channelName: 'general',
  isPrivate: false,
};
const actor = {
  platform: 'slack' as const,
  accountId: 'U1',
  displayName: 'Taro',
};

/** A `fetch` answering from a declared URL-substring -> body table. */
const fetchOf = (
  routes: Readonly<Record<string, { status?: number; body: unknown }>>,
): typeof fetch =>
  vi.fn((input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    const matched = Object.entries(routes).find(([fragment]) =>
      url.includes(fragment),
    );
    if (matched == null) {
      return Promise.resolve(
        new Response('not stubbed', { status: 599, statusText: url }),
      );
    }
    const [, answer] = matched;
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;

const contextOf = (
  overrides: Partial<ActorRoleContext> & { readonly fetch: typeof fetch },
): ActorRoleContext => ({
  workspaceId: 'T1',
  credentials: {},
  appConfig: { stateConnectionString: 'postgresql://state@postgres:5432/db' },
  channel,
  actor,
  ...overrides,
});

const slackCredentials: InstallationCredentials = {
  slack: { botToken: 'xoxb-1' },
};
const mattermostCredentials: InstallationCredentials = {
  mattermost: {
    baseUrl: 'https://mattermost.internal/',
    botToken: 'mm-token',
  },
};
const discordAppConfig: PlatformAppConfig = {
  stateConnectionString: 'postgresql://state@postgres:5432/db',
  discord: {
    applicationId: 'app-1',
    publicKey: 'public',
    clientSecret: 'discord-secret',
    botToken: 'discord-bot',
  },
};

describe('ROLE_READERS: Slack', () => {
  it("reads the workspace admin flags ADMIN_CHECK_TABLE names, and nothing it doesn't", async () => {
    const context = contextOf({
      credentials: slackCredentials,
      fetch: fetchOf({
        'users.info': {
          body: {
            ok: true,
            user: { id: 'U1', is_admin: true, is_owner: false, is_bot: false },
          },
        },
      }),
    });

    const roles = await ROLE_READERS.slack(context);

    expect(roles.grantedFields).toEqual(['is_admin']);
    expect(ADMIN_CHECK_TABLE.slack.fields).toContain('is_admin');
  });

  it('answers an empty set for a member of the workspace who is not an admin', async () => {
    const context = contextOf({
      credentials: slackCredentials,
      fetch: fetchOf({
        'users.info': {
          body: { ok: true, user: { id: 'U1', is_admin: false } },
        },
      }),
    });

    await expect(ROLE_READERS.slack(context)).resolves.toEqual({
      grantedFields: [],
    });
  });

  it('fails rather than answering "not an admin" when Slack reports ok:false', async () => {
    // Slack reports a missing scope as HTTP 200 carrying `{ok:false}`. Read as
    // an ordinary answer it would look like a workspace member with no admin
    // rights -- so the operator would be told to fix their own permissions for
    // a scope this proxy never asked for.
    const context = contextOf({
      credentials: slackCredentials,
      fetch: fetchOf({
        'users.info': { body: { ok: false, error: 'missing_scope' } },
      }),
    });

    await expect(ROLE_READERS.slack(context)).rejects.toThrow(/missing_scope/);
  });

  it('fails when this installation carries no Slack token to ask with', async () => {
    const context = contextOf({ fetch: fetchOf({}) });

    await expect(ROLE_READERS.slack(context)).rejects.toThrow(/token/i);
  });
});

describe('ROLE_READERS: Discord', () => {
  const guildId = 'G1';
  const discordContext = (
    routes: Parameters<typeof fetchOf>[0],
  ): ActorRoleContext =>
    contextOf({
      workspaceId: guildId,
      appConfig: discordAppConfig,
      channel: { ...channel, platform: 'discord' },
      actor: { ...actor, platform: 'discord' },
      fetch: fetchOf(routes),
    });

  it('reads the permission bits of every role the member holds', async () => {
    // MANAGE_GUILD is bit 5 (32).
    const roles = await ROLE_READERS.discord(
      discordContext({
        [`/guilds/${guildId}/members/`]: { body: { roles: ['role-mod'] } },
        [`/guilds/${guildId}/roles`]: {
          body: [
            { id: guildId, permissions: '0' },
            { id: 'role-mod', permissions: '32' },
          ],
        },
        [`/guilds/${guildId}`]: { body: { id: guildId, owner_id: 'someone' } },
      }),
    );

    expect(roles.grantedFields).toEqual(['MANAGE_GUILD']);
  });

  it("counts @everyone's own permissions, which a member's role list never names", async () => {
    // The `@everyone` role id equals the guild id and is absent from
    // `member.roles`, so a reader that walked only that list would miss a
    // permission the whole guild was granted.
    const roles = await ROLE_READERS.discord(
      discordContext({
        [`/guilds/${guildId}/members/`]: { body: { roles: [] } },
        [`/guilds/${guildId}/roles`]: {
          body: [{ id: guildId, permissions: '32' }],
        },
        [`/guilds/${guildId}`]: { body: { id: guildId, owner_id: 'someone' } },
      }),
    );

    expect(roles.grantedFields).toContain('MANAGE_GUILD');
  });

  it('treats the guild owner as holding every declared permission', async () => {
    const roles = await ROLE_READERS.discord(
      discordContext({
        [`/guilds/${guildId}/members/`]: { body: { roles: [] } },
        [`/guilds/${guildId}/roles`]: {
          body: [{ id: guildId, permissions: '0' }],
        },
        [`/guilds/${guildId}`]: {
          body: { id: guildId, owner_id: actor.accountId },
        },
      }),
    );

    expect([...roles.grantedFields].sort()).toEqual(
      [...ADMIN_CHECK_TABLE.discord.fields].sort(),
    );
  });

  it('answers an empty set for a member holding neither declared permission', async () => {
    const roles = await ROLE_READERS.discord(
      discordContext({
        [`/guilds/${guildId}/members/`]: { body: { roles: ['role-plain'] } },
        [`/guilds/${guildId}/roles`]: {
          body: [
            { id: guildId, permissions: '0' },
            { id: 'role-plain', permissions: '1024' },
          ],
        },
        [`/guilds/${guildId}`]: { body: { id: guildId, owner_id: 'someone' } },
      }),
    );

    expect(roles.grantedFields).toEqual([]);
  });

  it('fails when Discord refuses the request', async () => {
    await expect(
      ROLE_READERS.discord(
        discordContext({
          [`/guilds/${guildId}/members/`]: { status: 403, body: {} },
        }),
      ),
    ).rejects.toThrow(/403/);
  });
});

describe('ROLE_READERS: Mattermost', () => {
  const mattermostContext = (
    routes: Parameters<typeof fetchOf>[0],
  ): ActorRoleContext =>
    contextOf({
      credentials: mattermostCredentials,
      channel: { ...channel, platform: 'mattermost', channelId: 'mm-channel' },
      actor: { ...actor, platform: 'mattermost', accountId: 'mm-user' },
      fetch: fetchOf(routes),
    });

  it("reads the whole-server role from the user's own roles", async () => {
    const roles = await ROLE_READERS.mattermost(
      mattermostContext({
        '/api/v4/users/mm-user': {
          body: { id: 'mm-user', roles: 'system_user system_admin' },
        },
        '/api/v4/channels/mm-channel': { body: { team_id: 'team-1' } },
        '/api/v4/teams/team-1/members/mm-user': {
          body: { roles: 'team_user' },
        },
      }),
    );

    expect(roles.grantedFields).toContain('system_admin');
  });

  it('reads team_admin from the team of the channel the command was typed in, not from anywhere else', async () => {
    // `ADMIN_CHECK_TABLE` records that `team_admin` is team-scoped, and no
    // boolean answer can carry that scope -- so the channel's own team is what
    // decides it.
    const roles = await ROLE_READERS.mattermost(
      mattermostContext({
        '/api/v4/users/mm-user': { body: { roles: 'system_user' } },
        '/api/v4/channels/mm-channel': { body: { team_id: 'team-1' } },
        '/api/v4/teams/team-1/members/mm-user': {
          body: { roles: 'team_user team_admin' },
        },
      }),
    );

    expect(roles.grantedFields).toEqual(['team_admin']);
  });

  it('answers an empty set for an ordinary member of the team', async () => {
    const roles = await ROLE_READERS.mattermost(
      mattermostContext({
        '/api/v4/users/mm-user': { body: { roles: 'system_user' } },
        '/api/v4/channels/mm-channel': { body: { team_id: 'team-1' } },
        '/api/v4/teams/team-1/members/mm-user': {
          body: { roles: 'team_user' },
        },
      }),
    );

    expect(roles.grantedFields).toEqual([]);
  });

  it('reads only the server-wide roles when the command was typed outside any team', async () => {
    // A direct message carries an empty `team_id`, so there is no team
    // membership to ask about -- and asking anyway would address
    // `/teams//members/...`.
    const roles = await ROLE_READERS.mattermost(
      mattermostContext({
        '/api/v4/users/mm-user': { body: { roles: 'system_admin' } },
        '/api/v4/channels/mm-channel': { body: { team_id: '' } },
      }),
    );

    expect(roles.grantedFields).toEqual(['system_admin']);
  });

  it('fails when Mattermost refuses the request', async () => {
    await expect(
      ROLE_READERS.mattermost(
        mattermostContext({
          '/api/v4/users/mm-user': { status: 401, body: {} },
        }),
      ),
    ).rejects.toThrow(/401/);
  });
});

describe('ROLE_READERS: Teams', () => {
  it('reports that it cannot answer, rather than answering "not an owner"', async () => {
    // The two ids do not meet: an `Invocation` carries the Bot Framework user
    // id, Graph keys team membership by AAD object id. Answering `[]` here
    // would tell a genuine team owner they lack a role they hold.
    await expect(
      ROLE_READERS.teams(
        contextOf({
          channel: { ...channel, platform: 'teams' },
          actor: { ...actor, platform: 'teams' },
          fetch: fetchOf({}),
        }),
      ),
    ).rejects.toThrow(/teams/i);
  });
});

describe('observeActorRoles', () => {
  const reader = (answer: () => Promise<{ grantedFields: string[] }>) =>
    ({ slack: answer }) as unknown as Record<string, ActorRoleReader>;

  it('answers what the service said', async () => {
    const answer = await observeActorRoles(
      'slack',
      contextOf({ credentials: slackCredentials, fetch: fetchOf({}) }),
      reader(() =>
        Promise.resolve({ grantedFields: ['is_owner'] }),
      ) as unknown as typeof ROLE_READERS,
    );

    expect(answer).toEqual({ grantedFields: ['is_owner'] });
  });

  it('hands the reason over when the service could not be read, so the operator gets more than "contact the operator"', async () => {
    const reported: unknown[] = [];

    await observeActorRoles(
      'slack',
      contextOf({ credentials: slackCredentials, fetch: fetchOf({}) }),
      reader(() =>
        Promise.reject(new Error('missing_scope')),
      ) as unknown as typeof ROLE_READERS,
      (error) => reported.push(error),
    );

    expect(String(reported[0])).toContain('missing_scope');
  });

  it('answers null -- never an empty role set -- when the service could not be read', async () => {
    // This is the whole reason the readers throw instead of answering `[]`:
    // the two answers reach the operator as different messages.
    const answer = await observeActorRoles(
      'slack',
      contextOf({ credentials: slackCredentials, fetch: fetchOf({}) }),
      reader(() =>
        Promise.reject(new Error('missing_scope')),
      ) as unknown as typeof ROLE_READERS,
    );

    expect(answer).toBeNull();
  });
});
