// Asking each chat service which roles the person who typed an operator
// command holds -- the reading half of `capabilities/admin-check.ts`, whose
// `ADMIN_CHECK_TABLE` declares WHICH field each service's answer is read from
// but deliberately makes no call.
//
// This file exists here and nowhere else for the reason design.md gives: the
// answer can only come from the chat service, and `platform/` is the only
// layer allowed to name a Chat SDK. Everything to the right of it
// (`command/`, `orchestration/`, `runtime/`) therefore receives the facts and
// judges them (`isWorkspaceAdmin`), rather than fetching them.
//
// **No `if (platform === ...)` anywhere.** `ROLE_READERS` is a
// `Record<PlatformName, ActorRoleReader>`, so a fifth service is one entry
// here plus one row in `ADMIN_CHECK_TABLE`; and each reader asks the table for
// the field names it looks for rather than repeating them as literals, so the
// vocabulary `isWorkspaceAdmin` matches against has one source.
//
// **A failed read throws; it never answers an empty role set.** That is what
// keeps 「読み取れなかった」 separate from 「読めたが管理者ではない」 all the way
// out to the operator's message (see `AdminActorRoles`). `observeActorRoles`
// at the bottom is the single place a throw becomes `null`.
//
// **No adapter is used**, for the same reason `channels.ts` uses none: the
// Chat SDK's `Adapter` interface has no membership or role method at all (its
// only user-facing one is `getUser?(userId): Promise<UserInfo | null>`, and
// `UserInfo` carries a name, an avatar and an email -- no roles). Every reader
// is therefore addressed by explicit credentials and takes its `fetch` from
// the context, so all four are exercisable without a live service.
//
// **Not verified against a live service.** The endpoints and field names below
// follow each service's published API reference; no Slack, Discord or
// Mattermost credentials exist in this sandbox to confirm them, and neither
// are the scopes/permissions each call needs (Slack `users:read`, a Discord
// bot with the guild members intent, a Mattermost bot with
// `read_other_users_teams`). Same caveat `channels.ts` carries for its own
// Mattermost pagination.
import { assertSlackOk, callSlackApi } from '@chat-adapter/slack/api';
import type { ChannelRef, ChatAccountRef, PlatformName } from '@growi/chat';

import { ADMIN_CHECK_TABLE } from '../capabilities/index.js';
import type {
  AdminActorRoles,
  InstallationCredentials,
  PlatformAppConfig,
} from '../types/index.js';

/**
 * What a reader needs besides the service it serves. Shaped after
 * `ChannelListerContext` (`channels.ts`) and carrying both credential sources
 * for the same reason: the four services split across them exactly as
 * `ADAPTER_FACTORIES` describes.
 *
 * `channel` is here because one of the four declared fields is scoped to it:
 * Mattermost's `team_admin` means "an admin of THIS channel's team", so a
 * reader that ignored the channel would report an unrelated team's role.
 */
export interface ActorRoleContext {
  /** `installation.workspace_id` -- a Slack team, a Discord guild, a Teams tenant. */
  readonly workspaceId: string;
  readonly credentials: InstallationCredentials;
  readonly appConfig: PlatformAppConfig;
  /** The channel the command was typed in. */
  readonly channel: ChannelRef;
  /** The person who typed it. */
  readonly actor: ChatAccountRef;
  readonly fetch: typeof fetch;
}

/**
 * Resolves with the roles the actor holds, or throws. There is no "partly
 * read" answer: see the file header.
 */
export type ActorRoleReader = (
  context: ActorRoleContext,
) => Promise<AdminActorRoles>;

/** Raised when the values needed to ask a service about an actor are absent. */
export class MissingActorRoleCredentialsError extends Error {
  constructor(platform: PlatformName, missing: string) {
    super(
      `Cannot read a ${platform} actor's roles: no ${missing} credential is configured`,
    );
    this.name = 'MissingActorRoleCredentialsError';
  }
}

/** Raised by a service whose admin check cannot be made from what we hold. */
export class UnsupportedActorRoleCheckError extends Error {
  constructor(platform: PlatformName, why: string) {
    super(`Cannot read a ${platform} actor's roles: ${why}`);
    this.name = 'UnsupportedActorRoleCheckError';
  }
}

/**
 * The declared fields of one service that a predicate says the actor holds.
 *
 * Every reader answers through this, so the vocabulary that comes out is
 * always `ADMIN_CHECK_TABLE`'s own -- which is the vocabulary
 * `isWorkspaceAdmin` matches against.
 */
const grantedOf = (
  platform: PlatformName,
  holds: (field: string) => boolean,
): AdminActorRoles => ({
  grantedFields: ADMIN_CHECK_TABLE[platform].fields.filter(holds),
});

/** A JSON body read as a record, so unknown fields can be probed by name. */
const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

// --------------------------------------------------------------------------
// Slack -- user info's `is_admin` / `is_owner`
// --------------------------------------------------------------------------

const readSlackRoles: ActorRoleReader = async (context) => {
  const slack = context.credentials.slack;
  if (slack == null) {
    throw new MissingActorRoleCredentialsError('slack', 'Slack bot token');
  }

  const response = await callSlackApi(
    'users.info',
    { user: context.actor.accountId },
    { token: slack.botToken, fetch: context.fetch },
  );
  // Slack reports a missing scope or an unknown user as HTTP 200 carrying
  // `{ok:false, error:…}`. Left unchecked that reads as a workspace member
  // with no admin rights, and the operator would be sent to fix permissions
  // that were never the problem.
  assertSlackOk('users.info', response);

  const user = asRecord(response.user);
  return grantedOf('slack', (field) => user[field] === true);
};

// --------------------------------------------------------------------------
// Discord -- guild permission bits
// --------------------------------------------------------------------------

const DISCORD_API_BASE = 'https://discord.com/api/v10';

/**
 * The bit behind each permission name `ADMIN_CHECK_TABLE` declares for
 * Discord, written out rather than pulled from `discord-api-types` -- that
 * package is a dependency of `@chat-adapter/discord`, not of this app, and
 * adding it to name two constants would make this app depend on the adapter's
 * own dependency tree (the same call `channels.ts` makes for
 * `DISCORD_VIEW_CHANNEL`).
 */
const DISCORD_PERMISSION_BITS: Readonly<Record<string, bigint>> = {
  ADMINISTRATOR: 1n << 3n,
  MANAGE_GUILD: 1n << 5n,
};

interface DiscordRole {
  readonly id?: unknown;
  readonly permissions?: unknown;
}

/** A permissions field, which Discord sends as a decimal string. */
const permissionBitsOf = (value: unknown): bigint => {
  if (typeof value !== 'string') return 0n;
  try {
    return BigInt(value);
  } catch {
    // A non-numeric value is a shape this code does not understand. Reading it
    // as "no permissions" keeps the check fail-closed, which is the direction
    // an authorization decision must fail in.
    return 0n;
  }
};

const readDiscordRoles: ActorRoleReader = async (context) => {
  const discord = context.appConfig.discord;
  if (discord == null) {
    throw new MissingActorRoleCredentialsError('discord', 'Discord bot token');
  }

  const guildId = context.workspaceId;
  const get = async (path: string): Promise<unknown> => {
    const response = await context.fetch(`${DISCORD_API_BASE}${path}`, {
      headers: { authorization: `Bot ${discord.botToken}` },
    });
    if (!response.ok) {
      throw new Error(`Discord GET ${path} returned HTTP ${response.status}`);
    }
    return response.json();
  };

  const member = asRecord(
    await get(
      `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(context.actor.accountId)}`,
    ),
  );
  const guild = asRecord(await get(`/guilds/${encodeURIComponent(guildId)}`));
  const roles = await get(`/guilds/${encodeURIComponent(guildId)}/roles`);

  // `@everyone`'s role id equals the guild id, and Discord leaves it out of a
  // member's own role list -- so a permission granted to the whole guild is
  // only visible by adding it back here.
  const held = new Set<string>([
    guildId,
    ...(Array.isArray(member.roles)
      ? member.roles.filter((id): id is string => typeof id === 'string')
      : []),
  ]);

  const permissions = (Array.isArray(roles) ? (roles as DiscordRole[]) : [])
    .filter((role) => typeof role.id === 'string' && held.has(role.id))
    .reduce((bits, role) => bits | permissionBitsOf(role.permissions), 0n);

  // The two ways Discord grants everything at once: owning the guild, and
  // holding ADMINISTRATOR. Both are documented to imply every other
  // permission, so neither shows up in the remaining bits.
  const isOwner = guild.owner_id === context.actor.accountId;
  const hasEverything =
    isOwner || (permissions & DISCORD_PERMISSION_BITS.ADMINISTRATOR) !== 0n;

  return grantedOf('discord', (field) => {
    const bit = DISCORD_PERMISSION_BITS[field];
    if (bit == null) return false;
    return hasEverything || (permissions & bit) !== 0n;
  });
};

// --------------------------------------------------------------------------
// Mattermost -- `system_admin`, or `team_admin` on the channel's team
// --------------------------------------------------------------------------

/** Mattermost sends roles as one space-separated string. */
const mattermostRolesOf = (value: unknown): ReadonlyArray<string> =>
  typeof value === 'string'
    ? value.split(/\s+/).filter((role) => role !== '')
    : [];

const readMattermostRoles: ActorRoleReader = async (context) => {
  const mattermost = context.credentials.mattermost;
  if (mattermost == null) {
    throw new MissingActorRoleCredentialsError(
      'mattermost',
      'Mattermost bot token',
    );
  }

  const base = mattermost.baseUrl.replace(/\/+$/, '');
  const get = async (path: string): Promise<unknown> => {
    const response = await context.fetch(`${base}${path}`, {
      headers: { authorization: `Bearer ${mattermost.botToken}` },
    });
    if (!response.ok) {
      throw new Error(
        `Mattermost GET ${path} returned HTTP ${response.status}`,
      );
    }
    return response.json();
  };

  const userId = encodeURIComponent(context.actor.accountId);
  const user = asRecord(await get(`/api/v4/users/${userId}`));
  const held = new Set<string>(mattermostRolesOf(user.roles));

  // `team_admin` is an admin of ONE team, and the only team that can decide an
  // operator command is the one the command was typed in -- which the channel
  // names. A direct message belongs to no team (`team_id` is empty), so there
  // is nothing further to ask.
  const channel = asRecord(
    await get(
      `/api/v4/channels/${encodeURIComponent(context.channel.channelId)}`,
    ),
  );
  const teamId = typeof channel.team_id === 'string' ? channel.team_id : '';
  if (teamId !== '') {
    const membership = asRecord(
      await get(
        `/api/v4/teams/${encodeURIComponent(teamId)}/members/${userId}`,
      ),
    );
    for (const role of mattermostRolesOf(membership.roles)) held.add(role);
  }

  return grantedOf('mattermost', (field) => held.has(field));
};

// --------------------------------------------------------------------------
// Microsoft Teams
// --------------------------------------------------------------------------

/**
 * Teams cannot be answered from what an `Invocation` carries, and says so
 * rather than guessing.
 *
 * This is a boundary gap, not an impossibility -- the AAD object id Graph
 * needs IS reachable from a Teams activity (`@chat-adapter/teams`'s published
 * `./webhook` types expose `aadObjectId` on both `TeamsActivity.from` and
 * `TeamsWebhookUser`, and the adapter already reads it to fill `author.email`
 * when translating a message). What is missing is entirely on this app's own
 * side of the boundary, both outside this task's `platform`+`runtime` scope:
 *
 *  - **`Invocation`/`PlatformEvent` (`types/`) drop the raw activity.**
 *    `event-mapping.ts` builds a `ChatAccountRef` from only the Bot Framework
 *    user id (`29:…`); the AAD object id the activity actually carries never
 *    reaches this layer.
 *  - **The saved channel inventory (`db/`) has no team-id column.** Graph
 *    resolves membership by team, and a Teams channel id names no team on its
 *    own -- `listTeamsChannels` (`platform/channels.ts`) already has the
 *    team's own id in scope when it lists channels, but drops it before
 *    saving.
 *
 * The consequence is stated where it is visible rather than hidden behind a
 * plausible-looking `[]`: an operator command typed in Teams is refused with
 * 「権限を読み取れません」, so chat-originated pairing does not work there.
 * `[]` would instead tell a genuine team owner they are not one.
 */
const readTeamsRoles: ActorRoleReader = () =>
  Promise.reject(
    new UnsupportedActorRoleCheckError(
      'teams',
      'an Invocation carries only the Bot Framework user id, and the saved channel inventory carries no team id, so membership roles cannot be looked up from what this proxy holds today -- closing this needs a types/ and db/ change outside this reader',
    ),
  );

// --------------------------------------------------------------------------
// The declared set, and the one callable function
// --------------------------------------------------------------------------

/**
 * The single declared place that says how each service is asked for an actor's
 * roles -- the counterpart of `CHANNEL_LISTERS`, and read the same way.
 * `Record<PlatformName, …>` gives compile-time completeness.
 */
export const ROLE_READERS: Readonly<Record<PlatformName, ActorRoleReader>> = {
  slack: readSlackRoles,
  discord: readDiscordRoles,
  teams: readTeamsRoles,
  mattermost: readMattermostRoles,
};

/**
 * The roles one actor holds, or `null` when they could not be read at all.
 *
 * **This is the only place a failure becomes `null`.** Every reader either
 * answers the facts or throws, so `grantedFields: []` can only be reached by a
 * successful read -- which is what lets `AdminFlow` tell the operator whether
 * to look at their own permissions or at this proxy's configuration.
 *
 * `onUnreadable` receives whatever was thrown, because `null` on its own is
 * not actionable: the message the operator sees says 「proxy の運用者に連絡し
 * てください」, and what they then need is the missing Slack scope, the HTTP
 * 403 or the Teams explanation -- none of which survives the mapping to
 * `null`. Reporting is a callback rather than a log because no layer of this
 * app writes to a stream itself.
 *
 * `readers` is a parameter rather than a module-level lookup so this function
 * keeps one responsibility -- the dispatch and the fail-closed mapping -- and
 * stays exercisable without a live service (`.claude/rules/coding-style.md`,
 * "executors take their work-set as input"). `platform/index.ts` passes
 * `ROLE_READERS`.
 */
export const observeActorRoles = async (
  platform: PlatformName,
  context: ActorRoleContext,
  readers: Readonly<Record<PlatformName, ActorRoleReader>>,
  onUnreadable?: (error: unknown) => void,
): Promise<AdminActorRoles | null> => {
  try {
    return await readers[platform](context);
  } catch (error) {
    // Not rethrown: an unreadable answer is an ordinary outcome for the
    // caller, which already tells the operator what to do about it. The
    // reason is handed over rather than dropped.
    onUnreadable?.(error);
    return null;
  }
};
