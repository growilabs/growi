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
import { createDiscordAdapter } from '@chat-adapter/discord';
import { createSlackAdapter } from '@chat-adapter/slack';
import {
  createPostgresState,
  type PostgresStateAdapter,
} from '@chat-adapter/state-pg';
import { createTeamsAdapter } from '@chat-adapter/teams';
import type { PlatformName } from '@growi/chat';
import type { Adapter } from 'chat';
import { createMattermostAdapter } from 'chat-adapter-mattermost';

import type {
  InstallationCredentials,
  PlatformAppConfig,
} from '../types/index.js';

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
      readonly create: (appConfig: PlatformAppConfig) => Adapter | null;
    }
  | {
      readonly credentialSource: 'installation';
      /** `null` when this installation carries no credentials for the service. */
      readonly create: (credentials: InstallationCredentials) => Adapter | null;
    };

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
      create: (appConfig) => {
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
          // and the per-workspace token is resolved by `team_id` -- wiring the
          // adapter's `installationProvider` hook to `installation` is task
          // 3.2's job.
          // No `botToken` either: it is a single-workspace field.
        });
      },
    },
    discord: {
      credentialSource: 'app',
      create: (appConfig) => {
        const discord = appConfig.discord;
        if (discord == null) return null;
        return createDiscordAdapter({
          applicationId: discord.applicationId,
          publicKey: discord.publicKey,
          botToken: discord.botToken,
        });
      },
    },
    teams: {
      credentialSource: 'app',
      create: (appConfig) => {
        const teams = appConfig.teams;
        if (teams == null) return null;
        // The adapter names these `appId` / `appPassword`; design.md's
        // `PlatformAppConfig` names them `clientId` / `clientSecret` (the
        // wording Azure's own app-registration screen uses). Same two values,
        // two vocabularies -- this mapping is the only place they meet.
        return createTeamsAdapter({
          appId: teams.clientId,
          appPassword: teams.clientSecret,
        });
      },
    },
    mattermost: {
      credentialSource: 'installation',
      create: (credentials) => {
        const mattermost = credentials.mattermost;
        if (mattermost == null) return null;
        return createMattermostAdapter({
          baseUrl: mattermost.baseUrl,
          botToken: mattermost.botToken,
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
): Readonly<Partial<Record<PlatformName, Adapter>>> =>
  Object.fromEntries(
    Object.entries(factories).flatMap(([platform, factory]) => {
      if (factory.credentialSource !== 'app') return [];
      const adapter = factory.create(appConfig);
      return adapter == null ? [] : [[platform, adapter] as const];
    }),
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
): Adapter | null => {
  const factory = factories[platform];
  return factory.credentialSource === 'installation'
    ? factory.create(credentials)
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
