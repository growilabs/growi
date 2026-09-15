// Completing a chat service's OAuth handshake -- the half of
// `GET /install/{platform}/callback` that knows what Slack and Discord answer
// (design.md's 「呼ぶ入り口は 2 つ」 table, Slack / Discord row; Requirement
// 1.1).
//
// **Why this is in `platform/` and not in `routes/install-routes.ts`.** What
// `oauth.v2.access` returns, which of its fields names the workspace, and which
// service keeps a per-workspace credential at all is chat-service vocabulary,
// and design.md walls that into this layer. Everything this file exports is
// this app's own vocabulary (`PlatformName`, `InstallationCredentials`), so the
// route above it can complete an installation without ever naming a service's
// API. That the file happens to need no `@chat-adapter/*` import (see below) is
// not what decides its home.
//
// **The exchange is a plain HTTP call, not the SDK's own
// `SlackAdapter.handleOAuthCallback`.** That method was read before this was
// written, and it cannot be used here:
//
//  - It ends in `setInstallation()`, which throws
//    `Adapter not initialized. Ensure chat.initialize() has been called first.`
//    A callback that arrives before any connection is open -- the normal case,
//    since installing is what creates the workspace to connect for -- would
//    fail after a successful code exchange, with the code already spent.
//  - Initializing the app's Slack adapter to satisfy that means socket mode
//    (`ADAPTER_FACTORIES`), which `ConnectionManager` owns and which refuses
//    `clientId`/`clientSecret` outright (Implementation Note 3.1). Building a
//    SECOND, webhook-mode adapter just for the exchange would work, but its
//    `setInstallation()` writes the bot token into the Chat SDK's own state
//    store -- a second installation record shadowing the Postgres one design.md
//    declares as the single source of truth.
//  - `@chat-adapter/discord` exports no OAuth surface at all, so Discord is a
//    hand-written exchange either way. One mechanism for both services is the
//    better shape than one of each.
//
// **What is stored, and what is deliberately dropped.** Slack keeps a
// per-workspace bot token (`access_token`); Discord's bot token is app-level
// (`PlatformAppConfig.discord.botToken`), so `InstallationCredentials.discord`
// is `Record<string, never>` and the user access token Discord's exchange also
// returns is thrown away rather than written to a column nothing reads.
import type { PlatformName } from '@growi/chat';

import type {
  InstallationCredentials,
  PlatformAppConfig,
} from '../types/index.js';

/** Why an OAuth callback could not become an installation. */
export type OAuthCallbackFailureReason =
  /** This deployment configures no app for the service at all. */
  | 'not-configured'
  /** The service installs some other way (Mattermost) or not at all (Teams). */
  | 'unsupported-platform'
  /** No code, or an answer that named no workspace. */
  | 'invalid-callback'
  /** The service refused the exchange, or could not be reached. */
  | 'exchange-failed';

/** What a completed handshake yields, in this proxy's own vocabulary. */
export interface OAuthInstallation {
  readonly platform: PlatformName;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly credentials: InstallationCredentials;
}

export type OAuthCallbackResult =
  | { readonly ok: true; readonly installation: OAuthInstallation }
  | {
      readonly ok: false;
      readonly reason: OAuthCallbackFailureReason;
      /**
       * For the operator's record, never for the browser. It names what the
       * service said and never repeats a configured secret -- the caller
       * (`routes/install-routes.ts`) answers a generic page.
       */
      readonly detail: string;
    };

/** Everything one service's exchange needs, and nothing about HTTP routing. */
export interface OAuthExchangeContext {
  /** The `code` query parameter, already known to be present. */
  readonly code: string;
  /**
   * The redirect URI to echo back. Both services compare it against the one
   * the authorize link carried, so it has to be the same string.
   */
  readonly redirectUri: string;
  readonly appConfig: PlatformAppConfig;
  readonly fetch: typeof fetch;
}

export interface OAuthExchange {
  readonly exchange: (
    context: OAuthExchangeContext,
  ) => Promise<OAuthCallbackResult>;
}

/**
 * The services that install through an OAuth callback, and how each one
 * completes it. `Partial` on purpose: Teams carries no per-workspace
 * installation of its own, and Mattermost is read from a config file at
 * startup (`runtime/mattermost-installations.ts`), so neither has an entry --
 * absence here is what makes their callback path not exist at all rather than
 * exist and refuse.
 */
export type OAuthExchangeTable = Readonly<
  Partial<Record<PlatformName, OAuthExchange>>
>;

const SLACK_TOKEN_ENDPOINT = 'https://slack.com/api/oauth.v2.access';
const DISCORD_TOKEN_ENDPOINT = 'https://discord.com/api/v10/oauth2/token';

/**
 * Both services take the exchange as a form-encoded POST. Written once so the
 * two entries below differ only in the fields they send.
 */
const postForm = async (
  doFetch: typeof fetch,
  url: string,
  fields: Readonly<Record<string, string>>,
): Promise<{ status: number; body: unknown } | { error: string }> => {
  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    return { status: response.status, body: await response.json() };
  } catch {
    return { error: `answered ${response.status} with an unreadable body` };
  }
};

const failed = (
  reason: OAuthCallbackFailureReason,
  detail: string,
): OAuthCallbackResult => ({ ok: false, reason, detail });

/** Narrowing only: every field below is read defensively from the answer. */
const asRecord = (value: unknown): Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const readString = (
  source: Record<string, unknown>,
  key: string,
): string | null => {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : null;
};

export const OAUTH_EXCHANGES: OAuthExchangeTable = {
  slack: {
    exchange: async ({ code, redirectUri, appConfig, fetch: doFetch }) => {
      const slack = appConfig.slack;
      if (slack == null) {
        return failed('not-configured', 'no Slack app is configured');
      }

      const answer = await postForm(doFetch, SLACK_TOKEN_ENDPOINT, {
        client_id: slack.clientId,
        client_secret: slack.clientSecret,
        code,
        redirect_uri: redirectUri,
      });
      if ('error' in answer) {
        return failed('exchange-failed', `Slack ${answer.error}`);
      }

      const body = asRecord(answer.body);
      const botToken = readString(body, 'access_token');
      // Slack's own answer carries `ok: false` with a 200, so the status alone
      // is not the check.
      if (body.ok !== true || botToken == null) {
        return failed(
          'exchange-failed',
          `Slack refused the exchange: ${readString(body, 'error') ?? 'no access_token in the answer'}`,
        );
      }

      // An Enterprise Grid org-wide install answers `team: null` and is keyed
      // by the enterprise instead -- the same key Slack itself stores the
      // installation under, so events arriving over the socket resolve to it.
      const team = asRecord(body.team);
      const enterprise = asRecord(body.enterprise);
      const isEnterpriseInstall = body.is_enterprise_install === true;
      const workspaceId = isEnterpriseInstall
        ? readString(enterprise, 'id')
        : readString(team, 'id');
      if (workspaceId == null) {
        return failed(
          'exchange-failed',
          'Slack named no workspace in the answer',
        );
      }

      return {
        ok: true,
        installation: {
          platform: 'slack',
          workspaceId,
          workspaceName:
            readString(team, 'name') ??
            readString(enterprise, 'name') ??
            workspaceId,
          credentials: { slack: { botToken } },
        },
      };
    },
  },

  discord: {
    exchange: async ({ code, redirectUri, appConfig, fetch: doFetch }) => {
      const discord = appConfig.discord;
      if (discord == null) {
        return failed('not-configured', 'no Discord app is configured');
      }

      const answer = await postForm(doFetch, DISCORD_TOKEN_ENDPOINT, {
        // `applicationId` IS Discord's OAuth client id -- one value, two
        // vocabularies, the same reading `adapter-set.ts` does for Teams'
        // `clientId` / `appId`. `PlatformAppConfig` deliberately has no
        // separate `clientId` for Discord.
        client_id: discord.applicationId,
        client_secret: discord.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      });
      if ('error' in answer) {
        return failed('exchange-failed', `Discord ${answer.error}`);
      }
      if (answer.status < 200 || answer.status >= 300) {
        return failed(
          'exchange-failed',
          `Discord refused the exchange with ${answer.status}`,
        );
      }

      // The `guild` object is only present when the authorize link asked for
      // the `bot` scope and the user picked a server. Without it there is no
      // workspace to install into, and inventing one would create an
      // installation nothing can post to.
      const guild = asRecord(asRecord(answer.body).guild);
      const workspaceId = readString(guild, 'id');
      if (workspaceId == null) {
        return failed(
          'invalid-callback',
          'the Discord authorization named no server; the install link must ask for the bot scope',
        );
      }

      return {
        ok: true,
        installation: {
          platform: 'discord',
          workspaceId,
          workspaceName: readString(guild, 'name') ?? workspaceId,
          // Nothing per workspace: Discord's bot token is app-level.
          credentials: { discord: {} },
        },
      };
    },
  },
};

export interface OAuthCallbackDeps {
  readonly appConfig: PlatformAppConfig;
  /**
   * Overrides the redirect URI derived from the request. Needed only where the
   * proxy sits behind something that terminates TLS: the request then arrives
   * as `http://` on an internal name, while the authorize link carried the
   * public `https://` URL, and the two strings have to match exactly.
   */
  readonly redirectUri?: string;
  readonly fetch?: typeof fetch;
}

/**
 * Turns one OAuth callback request into an installation, or into a reason it
 * could not become one.
 *
 * `exchanges` is a parameter rather than a module-level lookup, the same shape
 * `createInstallationAdapter` uses: the caller that registers the callback
 * routes and the call that completes one then read the same table, so a
 * service can never have a route without an exchange or the reverse.
 */
export const completeOAuthCallback = async (
  platform: PlatformName,
  request: Request,
  deps: OAuthCallbackDeps,
  exchanges: OAuthExchangeTable,
): Promise<OAuthCallbackResult> => {
  const entry = exchanges[platform];
  if (entry == null) {
    return failed(
      'unsupported-platform',
      `${platform} does not install through an OAuth callback`,
    );
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  if (code == null || code === '') {
    // Includes the user pressing "cancel", which comes back as `error=`. The
    // service is not called: there is nothing to exchange.
    return failed(
      'invalid-callback',
      `the callback carried no code (${url.searchParams.get('error') ?? 'no error given'})`,
    );
  }

  return await entry.exchange({
    code,
    // The request arrived AT the redirect URI, so the URL it came in on is it
    // -- minus the query, which was added by the service.
    redirectUri: deps.redirectUri ?? `${url.origin}${url.pathname}`,
    appConfig: deps.appConfig,
    fetch: deps.fetch ?? fetch,
  });
};
