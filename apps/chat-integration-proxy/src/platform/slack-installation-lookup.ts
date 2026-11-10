// The Slack adapter's `installationProvider` hook, answered from this proxy's
// own installations. In multi-workspace socket mode every workspace's events
// arrive on one app-level socket, and the adapter asks this hook for the bot
// that answers in the workspace (or, for an Enterprise Grid org-wide install,
// the enterprise) an event came from. Without it the adapter falls back to the
// Chat SDK's own state store, which this proxy never writes installations into
// (see `oauth-callback.ts`), and no event can be answered.
//
// The key the adapter asks with -- team id, or enterprise id for an org-wide
// install -- is the same one `oauth-callback.ts` saves `workspace_id` under, so
// it is passed through unchanged.

import type {
  SlackAdapterConfig,
  SlackInstallation,
} from '@chat-adapter/slack';
import { assertSlackOk, callSlackApi } from '@chat-adapter/slack/api';

import type { InstallationProvider } from './installation-provider.js';

export type SlackInstallationLookup = NonNullable<
  SlackAdapterConfig['installationProvider']
>;

export interface SlackInstallationLookupDeps {
  readonly installations: InstallationProvider;
  readonly fetch?: typeof fetch;
}

export const createSlackInstallationLookup = (
  deps: SlackInstallationLookupDeps,
): SlackInstallationLookup => {
  // Keyed by token: the bot user id belongs to the token's bot, and a
  // reinstall that issues a new token is simply a new entry. Only successes
  // stay; a rejected lookup is dropped so the next event asks again.
  const botUserIds = new Map<string, Promise<string>>();

  const botUserIdOf = (botToken: string): Promise<string> => {
    const known = botUserIds.get(botToken);
    if (known != null) return known;

    const asked = (async () => {
      const response = await callSlackApi(
        'auth.test',
        {},
        {
          token: botToken,
          ...(deps.fetch == null ? {} : { fetch: deps.fetch }),
        },
      );
      assertSlackOk('auth.test', response);
      if (typeof response.user_id !== 'string' || response.user_id === '') {
        throw new Error('Slack auth.test answered no user_id');
      }
      return response.user_id;
    })();
    botUserIds.set(botToken, asked);
    asked.catch(() => botUserIds.delete(botToken));
    return asked;
  };

  return {
    getInstallation: async (installationId) => {
      const credentials = await deps.installations.resolve(
        'slack',
        installationId,
      );
      const botToken = credentials?.slack?.botToken;
      if (botToken == null) return null;

      // Without its own user id the adapter cannot tell the bot's posts from
      // a person's, so the bot would react to itself; leaving the event
      // unresolved is the safer failure.
      let botUserId: string;
      try {
        botUserId = await botUserIdOf(botToken);
      } catch {
        return null;
      }
      const installation: SlackInstallation = { botToken, botUserId };
      return installation;
    },
  };
};
