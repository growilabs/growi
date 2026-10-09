// design.md's File Structure Plan for this file: `listChannels`（周期で取り直して
// 保存）-- the `ChannelDirectory` row of the Components table.
//
// This file holds two things that are deliberately kept apart:
//
//  1. **How each service is asked for its channels** (`CHANNEL_LISTERS`).
//  2. **What is written once a complete answer is in hand**
//     (`refreshChannelInventory`).
//
// The separation is what makes design.md's failure rule implementable:
// 「取り直しの失敗 | 最後に取れた一覧をそのまま使い続ける（新しい一覧が取れる
// まで判定は変わらない）」. A listing either resolves as a whole or throws, and
// only a resolved listing reaches a write. Interleaving the two -- upserting
// each page as it arrives -- would leave `installation_channel` holding a mix
// of old and new rows after a mid-walk failure, which is a different inventory
// from the last one that was actually taken, even though `channels_synced_at`
// was never touched.
//
// **Who runs this on a schedule is not decided here.** design.md gives the
// periodic pull to `runtime/sweeper.ts`'s sibling under a distributed lock
// (tasks.md 9.2), and the one-off refresh right after `InstallationStore.save()`
// to that caller. Both call the plain function below.
//
// **No pruning.** Nothing here deletes a row for a channel that dropped off a
// service's answer. design.md does not ask for it, and `installation_channel`
// is keyed per installation with no cascade of its own, so removing rows would
// be a new behavior invented at this layer rather than a specified one. The
// cost is bounded and named: a channel the bot lost access to stays in the
// saved inventory until someone removes it, and a notification aimed at it is
// refused at post time with 「bot を招待してください」 instead of
// `channel-not-in-installation`.
//
// **No adapter is used.** The Chat SDK's `Adapter` has no channel-listing
// method at all (only `fetchChannelInfo(channelId)`, one channel by id), and
// Slack's `adapter.webClient` resolves its token from the in-flight webhook
// request -- which a periodic refresh does not have. Every lister below is
// therefore addressed by explicit credentials, and takes its `fetch` from the
// context so all four are exercisable without a live service.
import { assertSlackOk, callSlackApi } from '@chat-adapter/slack/api';
import { callTeamsGraphApi } from '@chat-adapter/teams/graph';
import type { ChannelInventory, PlatformName } from '@growi/chat';

import type {
  InstallationChannelRepository,
  InstallationRepository,
} from '../db/index.js';
import type {
  InstallationCredentials,
  PlatformAppConfig,
} from '../types/index.js';

/** One row of the answer. Named because every lister below builds these. */
type InventoryChannel = ChannelInventory['channels'][number];

/**
 * What a lister needs besides the service it serves.
 *
 * Both credential sources are carried because the four services split across
 * them the same way `ADAPTER_FACTORIES` describes: Slack and Mattermost are
 * addressed per installation, Discord with the app-wide bot token, and Teams
 * with the app's registration plus the installation's tenant.
 *
 * `fetch` is a field rather than the global for one reason: two of the four
 * services are reached over plain HTTP with no SDK helper in between, so this
 * is the only seam all four share.
 */
export interface ChannelListerContext {
  /** `installation.workspace_id` -- a Slack team, a Discord guild, a Teams tenant. */
  readonly workspaceId: string;
  readonly credentials: InstallationCredentials;
  readonly appConfig: PlatformAppConfig;
  readonly fetch: typeof fetch;
}

export type ChannelLister = (
  context: ChannelListerContext,
) => Promise<ReadonlyArray<InventoryChannel>>;

/**
 * Raised when the values needed to ask a service for its channels are absent.
 *
 * Deliberately a failure rather than an empty answer. An empty answer would be
 * written as 「取り直しは完了したが結果が空だった」, and design.md is explicit
 * that this state must stay distinguishable from 「一度も取れていない」 --
 * conflating them answers `channel-not-in-installation` for a workspace whose
 * inventory was never taken, 「運用者に間違った直し方…を案内してしまう」.
 */
export class MissingChannelCredentialsError extends Error {
  constructor(platform: PlatformName, missing: string) {
    super(
      `Cannot list ${platform} channels: no ${missing} credential is configured`,
    );
    this.name = 'MissingChannelCredentialsError';
  }
}

// --------------------------------------------------------------------------
// Slack
// --------------------------------------------------------------------------

/** Slack caps `conversations.list` at 1000 and recommends well under it. */
const SLACK_PAGE_SIZE = 200;

/**
 * A bound on every paginated walk in this file, for the same reason
 * `history.ts` bounds its own: a workspace with tens of thousands of channels
 * would otherwise hold the refresh open indefinitely. At `SLACK_PAGE_SIZE`
 * this covers 10,000 Slack channels.
 *
 * **Reaching it is a failure, not a stopping point** -- the opposite of
 * `history.ts`, which answers with what it found. A truncated inventory looks
 * exactly like a smaller workspace once it is written, so every channel past
 * the bound would be refused as `channel-not-in-installation` with no sign
 * that anything was cut off. Failing keeps the last complete inventory in
 * place instead.
 */
const MAX_PAGES = 50;

class TooManyPagesError extends Error {
  constructor(what: string) {
    super(
      `Refusing a truncated ${what}: more than ${MAX_PAGES} pages. The saved inventory is left as it was.`,
    );
    this.name = 'TooManyPagesError';
  }
}

interface SlackChannel {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly is_private?: unknown;
}

const toSlackChannel = (raw: SlackChannel): InventoryChannel | null => {
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  return {
    platform: 'slack',
    channelId: raw.id,
    channelName: typeof raw.name === 'string' ? raw.name : raw.id,
    isPrivate: raw.is_private === true,
  };
};

const listSlackChannels: ChannelLister = async (context) => {
  const slack = context.credentials.slack;
  if (slack == null) {
    throw new MissingChannelCredentialsError('slack', 'Slack bot token');
  }

  const collected: InventoryChannel[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    // Sequential because each page's cursor comes from the previous answer.
    // biome-ignore lint/performance/noAwaitInLoops: pagination is cursor-chained
    const response = await callSlackApi(
      'conversations.list',
      {
        exclude_archived: true,
        types: 'public_channel,private_channel',
        limit: SLACK_PAGE_SIZE,
        // Required on an Enterprise Grid org-wide token, ignored otherwise --
        // Slack documents always sending it as safe. Without it an org-wide
        // token lists the wrong workspaces' channels into this installation.
        team_id: context.workspaceId,
        ...(cursor == null ? {} : { cursor }),
      },
      { token: slack.botToken, fetch: context.fetch },
    );
    // `callSlackApi` resolves HTTP 200 carrying `{ok:false, error:…}` -- Slack
    // reports a missing scope that way. Left unchecked it would read as a
    // workspace with no channels.
    assertSlackOk('conversations.list', response);

    const channels = Array.isArray(response.channels)
      ? (response.channels as SlackChannel[])
      : [];
    for (const raw of channels) {
      const channel = toSlackChannel(raw);
      if (channel != null) collected.push(channel);
    }

    const next = response.response_metadata?.next_cursor;
    if (typeof next !== 'string' || next === '') return collected;
    cursor = next;
  }

  throw new TooManyPagesError('Slack channel listing');
};

// --------------------------------------------------------------------------
// Discord
// --------------------------------------------------------------------------

const DISCORD_API_BASE = 'https://discord.com/api/v10';

/**
 * The guild channel kinds a notification can be posted into: `GUILD_TEXT` (0)
 * and `GUILD_ANNOUNCEMENT` (5).
 *
 * Written as a declared set of numbers rather than pulled from
 * `discord-api-types`: that package is a dependency of `@chat-adapter/discord`,
 * not of this app, and adding it to name two constants would make this app
 * depend on the adapter's own dependency tree.
 */
const DISCORD_POSTABLE_CHANNEL_TYPES: ReadonlySet<number> = new Set([0, 5]);

/** Discord's `VIEW_CHANNEL` permission bit, sent as a decimal string. */
const DISCORD_VIEW_CHANNEL = 1n << 10n;

interface DiscordOverwrite {
  readonly id?: unknown;
  readonly deny?: unknown;
}

interface DiscordChannel {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly type?: unknown;
  readonly permission_overwrites?: unknown;
}

/**
 * Whether a guild channel is hidden from the server at large.
 *
 * Discord has no `is_private` field, so this reads the channel's own
 * permission overwrites: a channel counts as private when the `@everyone`
 * role -- whose role id equals the guild id -- is explicitly denied
 * `VIEW_CHANNEL` on it. That is a useful signal, not an exact one: it does not
 * see a channel restricted only through its parent category's permissions
 * (when the category's overwrites are not synced down to the channel itself),
 * and it does not see a channel that grants specific roles access without
 * ever explicitly denying `@everyone`. The alternative -- reporting
 * everything as public -- would mislabel every staff-only channel in the
 * administrator's notification-target picker, which is the more common and
 * more costly mistake, so this check stays as the best available signal.
 */
const isDiscordChannelPrivate = (
  raw: DiscordChannel,
  guildId: string,
): boolean => {
  const overwrites = Array.isArray(raw.permission_overwrites)
    ? (raw.permission_overwrites as DiscordOverwrite[])
    : [];
  return overwrites.some((overwrite) => {
    if (overwrite.id !== guildId) return false;
    if (typeof overwrite.deny !== 'string') return false;
    try {
      return (BigInt(overwrite.deny) & DISCORD_VIEW_CHANNEL) !== 0n;
    } catch {
      // A non-numeric `deny` is a shape this code does not understand; saying
      // "not private" there is the reading that keeps the channel visible as a
      // target rather than silently hiding it.
      return false;
    }
  });
};

const listDiscordChannels: ChannelLister = async (context) => {
  const discord = context.appConfig.discord;
  if (discord == null) {
    throw new MissingChannelCredentialsError('discord', 'Discord bot token');
  }

  const guildId = context.workspaceId;
  const response = await context.fetch(
    `${DISCORD_API_BASE}/guilds/${encodeURIComponent(guildId)}/channels`,
    { headers: { authorization: `Bot ${discord.botToken}` } },
  );
  if (!response.ok) {
    throw new Error(
      `Discord GET /guilds/${guildId}/channels returned HTTP ${response.status}`,
    );
  }

  const body: unknown = await response.json();
  const raws = Array.isArray(body) ? (body as DiscordChannel[]) : [];

  return raws.flatMap((raw) => {
    if (typeof raw.id !== 'string' || raw.id === '') return [];
    if (
      typeof raw.type !== 'number' ||
      !DISCORD_POSTABLE_CHANNEL_TYPES.has(raw.type)
    ) {
      return [];
    }
    return [
      {
        platform: 'discord' as const,
        channelId: raw.id,
        channelName: typeof raw.name === 'string' ? raw.name : raw.id,
        isPrivate: isDiscordChannelPrivate(raw, guildId),
      },
    ];
  });
};

// --------------------------------------------------------------------------
// Mattermost
// --------------------------------------------------------------------------

interface MattermostTeam {
  readonly id?: unknown;
}

interface MattermostChannelRow {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly display_name?: unknown;
  readonly type?: unknown;
}

/**
 * Mattermost channel kinds worth listing: `O` (open) and `P` (private).
 * `D` and `G` are direct and group conversations -- not something an
 * administrator picks as a notification target.
 */
const MATTERMOST_PRIVATE_TYPE = 'P';
const MATTERMOST_LISTED_TYPES: ReadonlySet<string> = new Set([
  'O',
  MATTERMOST_PRIVATE_TYPE,
]);

/**
 * `GET /api/v4/teams/{team_id}/channels` (a team's public channels) is
 * paginated -- `page` (default 0) and `per_page` (default 60), per
 * Mattermost's own OpenAPI reference (`v4/source/channels.yaml`). Sending
 * neither parameter, as this file used to, returns only the first 60 public
 * channels of a team and silently drops the rest -- a channel past that
 * point would never enter the inventory, so a notification aimed at it would
 * be refused as `channel-not-in-installation` (「作り直せ」) instead of
 * reaching it.
 *
 * `200` matches `MAX_CHANNEL_PAGE_SIZE` in `chat-adapter-mattermost`'s own
 * client, chosen here for the same reason: it is comfortably above Mattermost
 * Cloud's typical channel counts per team while keeping each page small. The
 * server-side hard maximum for `per_page` was NOT independently verified
 * against a live Mattermost instance in this sandbox (same category of
 * caveat this file already carries for other Mattermost specifics, e.g. the
 * bot-token team-membership constraint noted below) -- if a future server
 * version caps `per_page` lower than this, Mattermost is expected to return
 * a shorter page rather than error, which this loop's stopping condition
 * (a page shorter than requested) already treats as "last page".
 *
 * The other two Mattermost calls in this file -- `GET /users/me/teams` and
 * `GET /users/me/teams/{team_id}/channels` -- are confirmed NOT paginated
 * (per `v4/source/teams.yaml`: no `page`/`per_page` parameters, everything
 * returned unconditionally) and are deliberately left as single calls.
 */
const MATTERMOST_PAGE_SIZE = 200;

/**
 * Walks a team's public-channel listing to the end, the same way
 * `listSlackChannels` walks `conversations.list`: request a page, stop once a
 * page comes back shorter than requested, and fail loudly rather than
 * silently truncate if the team turns out to have more pages than `MAX_PAGES`
 * allows.
 */
const listMattermostPublicChannels = async (
  get: (path: string) => Promise<unknown>,
  teamId: string,
): Promise<ReadonlyArray<MattermostChannelRow>> => {
  const collected: MattermostChannelRow[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    // Sequential, same as the team loop this is called from: Mattermost's own
    // page numbering is offset-based, not cursor-chained, but there is no
    // reason to burst multiple pages of one team's channels concurrently
    // against what is often a small self-hosted server.
    // biome-ignore lint/performance/noAwaitInLoops: pagination is page-chained
    const body = await get(
      `/api/v4/teams/${encodeURIComponent(teamId)}/channels?page=${page}&per_page=${MATTERMOST_PAGE_SIZE}`,
    );
    const rows = Array.isArray(body) ? (body as MattermostChannelRow[]) : [];
    collected.push(...rows);
    if (rows.length < MATTERMOST_PAGE_SIZE) return collected;
  }

  throw new TooManyPagesError(
    `Mattermost public channel listing for team ${teamId}`,
  );
};

const listMattermostChannels: ChannelLister = async (context) => {
  const mattermost = context.credentials.mattermost;
  if (mattermost == null) {
    throw new MissingChannelCredentialsError(
      'mattermost',
      'Mattermost bot token',
    );
  }

  const base = mattermost.baseUrl.replace(/\/+$/, '');
  const headers = { authorization: `Bearer ${mattermost.botToken}` };

  const get = async (path: string): Promise<unknown> => {
    const response = await context.fetch(`${base}${path}`, { headers });
    if (!response.ok) {
      throw new Error(
        `Mattermost GET ${path} returned HTTP ${response.status}`,
      );
    }
    return response.json();
  };

  // A Mattermost channel lives inside a team, and the bot may be in several,
  // so the teams have to be walked first. `users/me` is the bot itself: the
  // token identifies it, so no user id has to be resolved.
  //
  // This one step is unavoidably participation-based, unlike the channel
  // listing below it: there is no endpoint that lists teams the bot is NOT a
  // member of, on any bot token. That is a genuine platform constraint, not
  // the same kind of gap the channel listing below had to be fixed for.
  const teamsBody = await get('/api/v4/users/me/teams');
  const teams = Array.isArray(teamsBody) ? (teamsBody as MattermostTeam[]) : [];

  const collected: InventoryChannel[] = [];
  for (const team of teams) {
    if (typeof team.id !== 'string' || team.id === '') continue;
    // Two calls per team, not one, for the same reason Slack asks for
    // `public_channel,private_channel` as two distinct types rather than one:
    // a bot token can list a team's PUBLIC channels regardless of whether the
    // bot has joined them (`GET /teams/{id}/channels`), but Mattermost has no
    // admin-wide endpoint for a team's PRIVATE channels -- those are only
    // visible through the channels the bot has actually joined
    // (`GET /users/me/teams/{id}/channels`). Answering only from the second
    // call -- as this lister used to -- conflates 「その workspace のチャンネ
    // ルか」(design.md) with 「bot が入っているチャンネルか」: a public channel
    // the bot has not been invited to would go missing from the inventory
    // entirely instead of surfacing as `bot-not-in-channel` at post time.
    //
    // Sequential rather than concurrent: a self-hosted Mattermost is often a
    // small server, and a burst of requests per refresh is the kind of load
    // this proxy's periodic pull exists to avoid.
    // biome-ignore lint/performance/noAwaitInLoops: two requests per team, on purpose
    const publicChannelRows = await listMattermostPublicChannels(get, team.id);
    const botJoinedChannelsBody = await get(
      `/api/v4/users/me/teams/${encodeURIComponent(team.id)}/channels`,
    );
    const botJoinedChannelRows = Array.isArray(botJoinedChannelsBody)
      ? (botJoinedChannelsBody as MattermostChannelRow[])
      : [];

    // De-duplicated by channel id: a public channel the bot has ALSO joined
    // appears in both responses, and must be written once, not twice.
    const rowsById = new Map<string, MattermostChannelRow & { id: string }>();
    for (const raws of [publicChannelRows, botJoinedChannelRows]) {
      for (const raw of raws) {
        if (typeof raw.id !== 'string' || raw.id === '') continue;
        rowsById.set(raw.id, { ...raw, id: raw.id });
      }
    }

    for (const raw of rowsById.values()) {
      if (
        typeof raw.type !== 'string' ||
        !MATTERMOST_LISTED_TYPES.has(raw.type)
      )
        continue;
      const displayName =
        typeof raw.display_name === 'string' && raw.display_name !== ''
          ? raw.display_name
          : null;
      const urlName = typeof raw.name === 'string' ? raw.name : raw.id;
      collected.push({
        platform: 'mattermost',
        channelId: raw.id,
        channelName: displayName ?? urlName,
        isPrivate: raw.type === MATTERMOST_PRIVATE_TYPE,
      });
    }
  }

  return collected;
};

// --------------------------------------------------------------------------
// Microsoft Teams
// --------------------------------------------------------------------------

interface GraphTeam {
  readonly id?: unknown;
}

interface GraphChannel {
  readonly id?: unknown;
  readonly displayName?: unknown;
  readonly membershipType?: unknown;
}

interface GraphPage {
  readonly value?: unknown;
  readonly '@odata.nextLink'?: unknown;
}

/**
 * Walks a Graph collection to the end, following `@odata.nextLink`.
 *
 * `paginateTeamsGraph` in the adapter is `callTeamsGraphApi` under another
 * name (it forwards an absolute next link to the same function), so the walk
 * is written once here rather than split across two helpers that do the same
 * thing.
 */
const walkGraph = async <T>(
  first: string,
  options: Parameters<typeof callTeamsGraphApi>[1],
): Promise<ReadonlyArray<T>> => {
  const collected: T[] = [];
  let next = first;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: pagination is link-chained
    const body: GraphPage = await callTeamsGraphApi<GraphPage>(next, options);
    if (Array.isArray(body.value)) collected.push(...(body.value as T[]));
    const link = body['@odata.nextLink'];
    if (typeof link !== 'string' || link === '') return collected;
    next = link;
  }

  throw new TooManyPagesError(`Graph collection '${first}'`);
};

const listTeamsChannels: ChannelLister = async (context) => {
  const teams = context.appConfig.teams;
  const installation = context.credentials.teams;
  if (teams == null || installation == null) {
    throw new MissingChannelCredentialsError(
      'teams',
      'Teams app registration and tenant credential',
    );
  }

  const options = {
    credentials: {
      appId: teams.clientId,
      appPassword: teams.clientSecret,
      tenantId: installation.tenantId,
    },
    fetch: context.fetch,
  };

  // A Teams installation is a tenant, and Graph addresses channels by team, so
  // the tenant's teams are enumerated first. This is application-permission
  // territory: `Team.ReadBasic.All` and `Channel.ReadBasic.All` have to be
  // granted to the app registration (docs/setup-teams.md).
  //
  // Listing every team in the tenant -- not only those the bot was added to --
  // is the right material for the check this feeds. design.md draws the line
  // explicitly: 「その workspace のチャンネルか」と「bot が入っているチャンネル
  // か」は別物, and it is the former this inventory answers. A channel the bot
  // has not been invited to is refused at post time with the remedy that
  // actually fixes it (invite the bot), rather than being denied here as a
  // channel that does not exist.
  const tenantTeams = await walkGraph<GraphTeam>('teams', options);

  const collected: InventoryChannel[] = [];
  for (const team of tenantTeams) {
    if (typeof team.id !== 'string' || team.id === '') continue;
    // biome-ignore lint/performance/noAwaitInLoops: one collection per team
    const channels = await walkGraph<GraphChannel>(
      `teams/${encodeURIComponent(team.id)}/channels`,
      options,
    );
    for (const raw of channels) {
      if (typeof raw.id !== 'string' || raw.id === '') continue;
      collected.push({
        platform: 'teams',
        channelId: raw.id,
        channelName:
          typeof raw.displayName === 'string' && raw.displayName !== ''
            ? raw.displayName
            : raw.id,
        // `membershipType` is `standard` | `private` | `shared`. Only
        // `private` restricts membership within the team; a shared channel is
        // visible to its own team plus invited ones.
        isPrivate: raw.membershipType === 'private',
      });
    }
  }

  return collected;
};

// --------------------------------------------------------------------------
// The declared set, and the two callable functions
// --------------------------------------------------------------------------

/**
 * The single declared place that says how each service is asked for its
 * channels (`.claude/rules/coding-style.md`, "data-driven control over
 * hard-coded mode checks"). `Record<PlatformName, …>` gives compile-time
 * completeness, so a fifth service is a one-entry change here.
 */
export const CHANNEL_LISTERS: Readonly<Record<PlatformName, ChannelLister>> = {
  slack: listSlackChannels,
  discord: listDiscordChannels,
  teams: listTeamsChannels,
  mattermost: listMattermostChannels,
};

/**
 * The channels one installation has, as `PlatformFacade.listChannels` answers
 * them. Resolves with the complete inventory or throws; there is no partial
 * answer, because a partial answer written to storage is indistinguishable
 * from a smaller workspace.
 *
 * `listers` is a parameter rather than a module-level lookup so this function
 * keeps one responsibility -- the dispatch -- and stays exercisable without a
 * live service (`.claude/rules/coding-style.md`, "executors take their
 * work-set as input"). `platform/index.ts` (task 3.8) passes
 * `CHANNEL_LISTERS`, along with the credentials it resolved for the
 * installation.
 */
export const listChannels = async (
  platform: PlatformName,
  context: ChannelListerContext,
  listers: Readonly<Record<PlatformName, ChannelLister>>,
): Promise<ChannelInventory> => ({
  channels: await listers[platform](context),
});

/** What one refresh needs. See `refreshChannelInventory`. */
export interface ChannelRefreshDeps {
  /**
   * `PlatformFacade.listChannels` -- passed as a function rather than
   * assembled here because resolving an installation id to its platform and
   * credentials is `platform/index.ts`'s job (task 3.8).
   */
  readonly listChannels: (installationId: string) => Promise<ChannelInventory>;
  readonly channels: InstallationChannelRepository;
  readonly installations: InstallationRepository;
  /** Injected so the stored timestamps are assertable. */
  readonly now: () => Date;
}

/**
 * Takes one installation's channel inventory again and saves it.
 *
 * **Nothing is written unless the listing succeeded in full.** The failure is
 * re-thrown rather than swallowed: the caller that runs this on a schedule
 * (tasks.md 9.2) is the one that can log it or count it, and design.md's rule
 * for a failed refresh is only about the stored state -- 「最後に取れた一覧を
 * そのまま使い続ける」 -- not about hiding the failure.
 *
 * One timestamp is taken for the whole refresh and stamped on every row and on
 * `channels_synced_at`, so 「この一覧はいつ取れたものか」 has one answer rather
 * than one per row.
 *
 * `channels_synced_at` is written even when the service reported no channels
 * (design.md: 「結果によらず（0 件でも）完了するたびに現在時刻を書く」). That
 * write is what separates 「一度も取れていない」 from 「取れた結果が空だった」,
 * and the separation is the whole point: answering
 * `channel-not-in-installation` for a workspace that was never listed sends
 * the operator to re-create a channel that was never missing.
 */
export const refreshChannelInventory = async (
  deps: ChannelRefreshDeps,
  installationId: string,
): Promise<void> => {
  const inventory = await deps.listChannels(installationId);
  const refreshedAt = deps.now();

  for (const channel of inventory.channels) {
    // Sequential: one installation's channel count is small, and the storage
    // layer offers a single-row upsert on purpose (no bulk replace exists,
    // because nothing here deletes).
    // biome-ignore lint/performance/noAwaitInLoops: one upsert per channel
    await deps.channels.upsert({
      installationId,
      platform: channel.platform,
      channelId: channel.channelId,
      channelName: channel.channelName,
      isPrivate: channel.isPrivate,
      refreshedAt,
    });
  }

  await deps.installations.markChannelsSynced(installationId, refreshedAt);
};
