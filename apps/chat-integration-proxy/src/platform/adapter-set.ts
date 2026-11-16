// `platform/` is the only layer allowed to touch the Chat SDK (design.md's
// Allowed Dependencies; enforced by `src/architecture.spec.ts`'s Chat SDK
// origin guard). This file is where the SDK's four platform adapters and its
// PostgreSQL state adapter are actually constructed -- 「接続情報を受け取って
// アダプタと state を組み立てる」.
//
// Everything here deals in Chat SDK types (`Adapter`, `PostgresStateAdapter`).
// That is fine *inside* this layer: the invariant design.md states is about
// the layer's outward-facing surface (`PlatformFacade`), not about its
// internals. `bot-factory.ts` composes what this file builds; nothing outside
// `platform/` imports either.
import { createDiscordAdapter, DiscordAdapter } from '@chat-adapter/discord';
import {
  createSlackAdapter,
  SlackAdapter,
  type SlackAdapterConfig,
} from '@chat-adapter/slack';
import {
  createPostgresState,
  type PostgresStateAdapter,
} from '@chat-adapter/state-pg';
import { createTeamsAdapter } from '@chat-adapter/teams';
import type { NativeChannelId, PlatformName } from '@growi/chat';
import type { Adapter, Logger } from 'chat';
import { createMattermostAdapter } from 'chat-adapter-mattermost';

import type {
  InstallationCredentials,
  PlatformAppConfig,
} from '../types/index.js';
import { SLACK_REQUEST_DEADLINE_MS } from './answer-delivery-window.js';
import type { InstallationProvider } from './installation-provider.js';
import type { ListenerWindow } from './listener-loop.js';
import { createSlackInstallationLookup } from './slack-installation-lookup.js';

/** What every adapter is built with besides its credentials. */
export interface AdapterContext {
  /**
   * Where the adapter logs, made by `createSdkLogger` with a reporter.
   * Some failures an adapter only logs and then drops -- a Slack event whose
   * workspace token cannot be resolved, a Discord Gateway login that fails --
   * so this is the only place the operator learns of them. Never the
   * adapter's default logger, which prints the failed request it was given,
   * credentials included.
   */
  readonly logger: Logger;
}

/**
 * What an app-credentialed adapter may need beyond the app config: a service
 * that serves many workspaces over one app-wide connection (Slack) resolves
 * each workspace's bot from this proxy's installations.
 */
export interface AppAdapterContext extends AdapterContext {
  readonly installations: InstallationProvider;
  /**
   * Where the Slack adapter sends its Web API calls. Left out in production,
   * which talks to Slack itself; a test points it at a loopback stand-in so
   * the adapter this factory builds can be exercised as built.
   */
  readonly slackApiUrl?: string;
}

/**
 * Shows "the bot is working on it" on the thread rooted at `threadRootId`,
 * on the service's own side. Runs inside the installation's scope, and may
 * reject; the caller absorbs that.
 */
export type ProcessingStatusSetter = (
  adapter: Adapter,
  channelId: NativeChannelId,
  threadRootId: string,
) => Promise<void>;

/** What Slack's thread status line reads after the bot's name. */
const SLACK_PROCESSING_STATUS = '考えています…';

/**
 * Where one service reads the credentials it needs to be constructed at all
 * (design.md: 「アプリごとの接続は `PlatformAppConfig` から開き、installation
 * ごとの接続は `InstallationCredentials` から開く」).
 *
 * This axis is declared here rather than derived from `CONNECTION_UNIT_TABLE`
 * (`capabilities/`) on purpose. Teams is `{ kind: 'none' }` there -- it opens
 * no outbound connection at all -- yet its adapter is still built once per app
 * from `PlatformAppConfig`. Deriving "app-credentialed" from "not
 * per-installation" would therefore be true only by coincidence today.
 *
 * It is not derived from `PlatformAppConfig`'s shape either: an interface's
 * optional keys do not exist at runtime, so nothing can iterate them.
 * `Record<PlatformName, AdapterFactory>` below still gives compile-time
 * completeness across all four services.
 */
export type AdapterFactory =
  | {
      readonly credentialSource: 'app';
      /** `null` when this deployment does not configure the service at all. */
      readonly create: (
        appConfig: PlatformAppConfig,
        context: AppAdapterContext,
      ) => Adapter | null;
      /**
       * Present when the service can show a processing indicator. Answers
       * `null` when this deployment's configuration turns it off, so the
       * caller never has to know which setting that is.
       */
      readonly processingStatus?: (
        appConfig: PlatformAppConfig,
      ) => ProcessingStatusSetter | null;
      /**
       * Present when the service has an AI app view in its DMs. Answers
       * whether this deployment's configuration turned it on.
       */
      readonly agentView?: (appConfig: PlatformAppConfig) => boolean;
      /**
       * Present when one adapter speaks for many workspaces and learns whose
       * bot to speak as only from the incoming event. Outside an event --
       * a notification from GROWI -- it has to be told, and this is how:
       * `work` runs as `installation`'s bot. Throws when the installation
       * carries nothing to speak with.
       */
      readonly bindInstallation?: <T>(
        adapter: Adapter,
        installation: {
          readonly workspaceId: string;
          readonly credentials: InstallationCredentials;
        },
        work: () => Promise<T>,
      ) => Promise<T>;
      /**
       * Which workspace -- the key `installation.workspace_id` is stored
       * under -- the event being handled on `adapter` came from, given the
       * channel id (Chat SDK form) the event names. `null` when the service
       * says that conversation belongs to no workspace at all. Called only
       * inside that event's handling. Throws when the service cannot say.
       */
      readonly workspaceOfEvent?: (
        adapter: Adapter,
        channelId: string,
      ) => Promise<string | null>;
      /**
       * Present when initializing the adapter does not by itself start
       * receiving events, and the SDK instead listens for one bounded window
       * per call. The connection that holds this service's lock keeps
       * calling it (`listener-loop.ts`) until the lock is given back.
       * Rejects when the window could not be opened.
       */
      readonly startListenerWindow?: (
        adapter: Adapter,
        durationMs: number,
        signal: AbortSignal,
      ) => Promise<ListenerWindow>;
    }
  | {
      readonly credentialSource: 'installation';
      /** `null` when this installation carries no credentials for the service. */
      readonly create: (
        credentials: InstallationCredentials,
        context: AdapterContext,
      ) => Adapter | null;
    };

/**
 * Which workspace a Slack bot token belongs to. A token never moves between
 * workspaces, so each is asked about once per process; a failed answer is
 * dropped so the next event asks again. Keyed by token, like the bot user id
 * cache in `slack-installation-lookup.ts`, so a reinstall is a new entry.
 */
type SlackWebClient = SlackAdapter['webClient'];

const slackWorkspaceByToken = new Map<string, Promise<string>>();

const slackWorkspaceOfToken = (client: SlackWebClient): Promise<string> => {
  const token = client.token;
  const known = token == null ? undefined : slackWorkspaceByToken.get(token);
  if (known != null) return known;

  const asked = (async () => {
    const answer = await client.auth.test();
    const workspaceId =
      answer.is_enterprise_install === true
        ? answer.enterprise_id
        : answer.team_id;
    if (workspaceId == null || workspaceId === '') {
      throw new Error('Slack auth.test named no workspace');
    }
    return workspaceId;
  })();
  if (token != null) {
    slackWorkspaceByToken.set(token, asked);
    asked.catch(() => slackWorkspaceByToken.delete(token));
  }
  return asked;
};

/**
 * The options every Slack Web API client of the adapter is built with. Each
 * call is tried once and ends within `requestDeadlineMs`: the client's default
 * retry policy and its wait on a rate limit would otherwise go on for about
 * thirty minutes (see `SLACK_REQUEST_DEADLINE_MS`). The deadline is an abort
 * signal per request rather than the client's `timeout`, which only measures
 * how long the connection stays silent.
 *
 * A request that fails before Slack answers would otherwise carry the HTTP
 * request it came from -- `Authorization: Bearer <token>` and the `token=`
 * body -- to whoever prints the error.
 */
export const slackWebClientOptions = (
  requestDeadlineMs: number,
): NonNullable<SlackAdapterConfig['webClientOptions']> => ({
  retryConfig: { retries: 0 },
  rejectRateLimitedCalls: true,
  requestInterceptor: (config) => ({
    ...config,
    signal: AbortSignal.timeout(requestDeadlineMs),
  }),
  attachOriginalToWebAPIRequestError: false,
});

/**
 * The single declared place that says how each of the four services is
 * constructed. Consumers below iterate this table; none of them branches on a
 * service name (`.claude/rules/coding-style.md`, "data-driven control over
 * hard-coded mode checks"), so adding a fifth service is a one-entry change
 * here plus a row in `@growi/chat`'s `PlatformName`.
 */
export const ADAPTER_FACTORIES: Readonly<Record<PlatformName, AdapterFactory>> =
  {
    slack: {
      credentialSource: 'app',
      create: (appConfig, context) => {
        const slack = appConfig.slack;
        if (slack == null) return null;
        return createSlackAdapter({
          // Required: the adapter defaults to `"webhook"`, and design.md's
          // 接続の単位 table commits Slack to one Socket Mode connection per
          // app. Left at the default, the bot would construct cleanly and
          // never receive an event.
          mode: 'socket',
          appToken: slack.appToken,
          // `signingSecret` is not what verifies a socket-mode event -- it is
          // passed because the adapter falls back to `SLACK_BOT_TOKEN` /
          // `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` from the environment
          // when handed *no* auth-shaped field at all. `runtime/config.ts` is
          // this app's only reader of `process.env` (Implementation Note 1.5),
          // so that fallback must not be left open.
          signingSecret: slack.signingSecret,
          // `clientId` / `clientSecret` are deliberately NOT passed: the
          // adapter rejects them outright in socket mode ("Multi-workspace
          // (clientId/clientSecret) is not supported in socket mode"), because
          // they configure the adapter's *own* OAuth flow. This proxy runs its
          // own callback instead (`routes/install-routes.ts`), which is what
          // those two values in `PlatformAppConfig` are for. Multi-workspace
          // socket mode still works: events arrive on the one app-level socket
          // and each workspace's bot is resolved through `installationProvider`.
          // No `botToken` either: it is a single-workspace field.
          installationProvider: createSlackInstallationLookup({
            installations: context.installations,
          }),
          // Off unless the operator enabled it: the adapter then roots a thread
          // at every DM message (research.md, AI app view).
          ...(slack.agentView === true ? { agentView: true } : {}),
          // The adapter hands these options to its per-workspace clients as
          // well, so every Slack call it makes is bounded the same way.
          webClientOptions: slackWebClientOptions(SLACK_REQUEST_DEADLINE_MS),
          ...(context.slackApiUrl == null
            ? {}
            : { apiUrl: context.slackApiUrl }),
          logger: context.logger.child('slack'),
        });
      },
      agentView: (appConfig) => appConfig.slack?.agentView === true,
      processingStatus: (appConfig) =>
        appConfig.slack?.agentView === true
          ? async (adapter, channelId, threadRootId) => {
              if (!(adapter instanceof SlackAdapter)) {
                throw new TypeError(
                  'a Slack status was handed a non-Slack adapter',
                );
              }
              await adapter.setAssistantStatus(
                channelId,
                threadRootId,
                SLACK_PROCESSING_STATUS,
              );
            }
          : null,
      // The adapter reads the token from its request context, which only an
      // incoming event fills in; `withBotToken` fills it for `work`. The
      // workspace id is passed as the adapter's own `installationId` -- the
      // team (or enterprise) id its event contexts carry -- so per-workspace
      // caches stay keyed the same way on both paths.
      bindInstallation: (adapter, { workspaceId, credentials }, work) => {
        const botToken = credentials.slack?.botToken;
        if (botToken == null) {
          throw new Error(
            `Slack workspace ${workspaceId} has no bot token on record`,
          );
        }
        if (!(adapter instanceof SlackAdapter)) {
          throw new TypeError('a Slack binding was handed a non-Slack adapter');
        }
        return adapter.withBotToken(botToken, work, {
          installationId: workspaceId,
        });
      },
      // Not every event names its team or enterprise (`member_joined_channel`
      // does not), but the adapter has already bound that workspace's bot
      // token for the event, and `auth.test` answers whose token it is. Read
      // the same way `oauth-callback.ts` stores `workspace_id`. A Slack DM
      // belongs to its workspace like any channel, so this never answers
      // `null`.
      workspaceOfEvent: (adapter) => {
        if (!(adapter instanceof SlackAdapter)) {
          throw new TypeError('a Slack lookup was handed a non-Slack adapter');
        }
        return slackWorkspaceOfToken(adapter.webClient);
      },
    },
    discord: {
      credentialSource: 'app',
      // Every Discord channel id the adapter hands an event with carries its
      // guild, the id `oauth-callback.ts` stores as `workspace_id`; a DM
      // carries `@me` instead, belonging to no guild.
      workspaceOfEvent: (adapter, channelId) => {
        if (!(adapter instanceof DiscordAdapter)) {
          throw new TypeError(
            'a Discord lookup was handed a non-Discord adapter',
          );
        }
        return Promise.resolve(
          adapter.isDM(channelId)
            ? null
            : adapter.decodeThreadId(channelId).guildId,
        );
      },
      create: (appConfig, context) => {
        const discord = appConfig.discord;
        if (discord == null) return null;
        return createDiscordAdapter({
          applicationId: discord.applicationId,
          publicKey: discord.publicKey,
          botToken: discord.botToken,
          logger: context.logger.child('discord'),
        });
      },
      // No `webhookUrl`: without one the adapter hands each Gateway event to
      // the Chat instance it was initialized with, the one every handler is
      // registered on. The window promise reaches us only through
      // `waitUntil`, and it never rejects (research.md).
      startListenerWindow: async (adapter, durationMs, signal) => {
        if (!(adapter instanceof DiscordAdapter)) {
          throw new TypeError(
            'a Discord listener was handed a non-Discord adapter',
          );
        }
        const captured: { listening?: Promise<unknown> } = {};
        const response = await adapter.startGatewayListener(
          {
            waitUntil: (task) => {
              captured.listening = task;
            },
          },
          durationMs,
          signal,
        );
        const { listening } = captured;
        if (!response.ok || listening == null) {
          throw new Error(
            `the Discord Gateway listener did not start (${response.status}): ${await response.text()}`,
          );
        }
        return { ended: listening.then(() => undefined) };
      },
    },
    teams: {
      credentialSource: 'app',
      create: (appConfig, context) => {
        const teams = appConfig.teams;
        if (teams == null) return null;
        // The adapter names these `appId` / `appPassword`; design.md's
        // `PlatformAppConfig` names them `clientId` / `clientSecret` (the
        // wording Azure's own app-registration screen uses). Same two values,
        // two vocabularies -- this mapping is the only place they meet.
        return createTeamsAdapter({
          appId: teams.clientId,
          appPassword: teams.clientSecret,
          logger: context.logger.child('teams'),
        });
      },
    },
    mattermost: {
      credentialSource: 'installation',
      create: (credentials, context) => {
        const mattermost = credentials.mattermost;
        if (mattermost == null) return null;
        return createMattermostAdapter({
          baseUrl: mattermost.baseUrl,
          botToken: mattermost.botToken,
          logger: context.logger.child('mattermost'),
        });
      },
    },
  };

/**
 * Every app-credentialed adapter this deployment configures, keyed by service
 * name. The key doubles as the Chat SDK adapter name, which is what
 * `chat.webhooks.<name>()` is addressed by -- so it must stay equal to
 * `PlatformName` for `PlatformFacade.webhookHandler(platform)` (task 3.8) to
 * find its handler.
 *
 * A service with no `PlatformAppConfig` block simply does not appear: it is
 * the config's optional fields that decide this, not the capability table.
 *
 * `factories` is a parameter rather than a module-level lookup so that this
 * function keeps one responsibility -- the iteration -- and can be exercised
 * without constructing a real SDK adapter (`.claude/rules/coding-style.md`,
 * "executors take their work-set as input").
 */
export const createAppAdapters = (
  appConfig: PlatformAppConfig,
  factories: Readonly<Record<PlatformName, AdapterFactory>>,
  context: AppAdapterContext,
): Readonly<Partial<Record<PlatformName, Adapter>>> =>
  Object.fromEntries(
    Object.entries(factories).flatMap(([platform, factory]) => {
      if (factory.credentialSource !== 'app') return [];
      const adapter = factory.create(appConfig, context);
      return adapter == null ? [] : [[platform, adapter] as const];
    }),
  );

/**
 * How to show the processing indicator on `platform`, or `null` when the
 * service has none or this deployment turned it off.
 */
export const processingStatusSetterOf = (
  platform: PlatformName,
  appConfig: PlatformAppConfig,
  factories: Readonly<Record<PlatformName, AdapterFactory>>,
): ProcessingStatusSetter | null => {
  const factory = factories[platform];
  return factory.credentialSource === 'app'
    ? (factory.processingStatus?.(appConfig) ?? null)
    : null;
};

/** The services whose DMs this deployment turned into an AI app view. */
export const agentViewPlatformsOf = (
  appConfig: PlatformAppConfig,
  factories: Readonly<Record<PlatformName, AdapterFactory>>,
): ReadonlySet<PlatformName> =>
  new Set(
    (Object.keys(factories) as ReadonlyArray<PlatformName>).filter(
      (platform) => {
        const factory = factories[platform];
        return (
          factory.credentialSource === 'app' &&
          factory.agentView?.(appConfig) === true
        );
      },
    ),
  );

/**
 * The adapter for one installation of an installation-credentialed service
 * (Mattermost, whose server URL differs per installation). Returns `null` both
 * when the service is app-credentialed -- it cannot be opened per installation
 * -- and when this installation carries no credentials for it.
 */
export const createInstallationAdapter = (
  platform: PlatformName,
  credentials: InstallationCredentials,
  factories: Readonly<Record<PlatformName, AdapterFactory>>,
  context: AdapterContext,
): Adapter | null => {
  const factory = factories[platform];
  return factory.credentialSource === 'installation'
    ? factory.create(credentials, context)
    : null;
};

/**
 * The Chat SDK's own state store: thread subscriptions, its per-thread
 * concurrency locks, and the distributed lock `bot-factory.ts` re-exposes.
 *
 * The connection string is passed explicitly. `createPostgresState()` falls
 * back to `POSTGRES_URL` / `DATABASE_URL` when given none, and this app
 * deliberately keeps the SDK's connection under a differently-named variable
 * (`CHAT_SDK_DATABASE_URL`, selecting the `chat_sdk` schema -- Implementation
 * Note 1.2), so an implicit fallback would put the SDK's tables in this app's
 * own Prisma database.
 */
export const createChatState = (
  appConfig: PlatformAppConfig,
): PostgresStateAdapter =>
  createPostgresState({ url: appConfig.stateConnectionString });
