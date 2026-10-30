// The OAuth callback, and **the only HTTP way an installation comes into
// existence** (design.md's File Structure Plan says so in as many words;
// Requirement 1.1). Gen 1's `GET /oauth_redirect` is the endpoint this
// replaces, one path per service instead of one shared one.
//
// **The handler decides nothing about OAuth.** What a service answers, which
// field names the workspace, and which credential is worth keeping all live in
// `platform/oauth-callback.ts` -- that file's header explains why. What is
// decided here is the four things at the HTTP edge:
//
//  1. **Which paths exist.** One per entry of the exchange table, so a service
//     that installs another way (Mattermost, from a config file at startup) or
//     not at all (Teams) has no callback route rather than a route that
//     refuses. A stray `GET /install/teams/callback` is a 404 from Hono.
//  2. **What the browser is told.** A plain page either way, and on failure a
//     GENERIC one: the reason comes from a service this proxy called on behalf
//     of whoever opened the link, and repeating it back would hand an
//     unauthenticated visitor the proxy's view of the exchange.
//  3. **That the reason is not lost.** It goes to `onInstallFailed`, which is
//     required rather than optional for the reason `InstallationStore`'s
//     `onChannelRefreshFailed` is (task 3.7): an operator watching an install
//     fail needs to be told why, and an omittable reporter is one nobody
//     passes. This app has no logger of its own, so the report travels as a
//     function.
//  4. **`signatureGuard` is not mounted, and must not be.** These paths carry
//     no `op` and are absent from `INBOUND_OP_BY_PATH`, so the guard would
//     refuse every callback with a 401. The caller here is a browser following
//     a redirect from Slack or Discord, not a paired GROWI; what stands in for
//     a signature is the code, which is single-use and only that service could
//     have issued.
//
// **The credentials never pass through this file's own hands.** The exchange
// answers an `OAuthInstallation` and it goes to `InstallationStore.save()`
// whole; nothing here reads `installation.credentials`.
import type { PlatformName } from '@growi/chat';
import type { Env, Hono } from 'hono';

import type {
  InstallationStore,
  OAuthCallbackFailureReason,
  OAuthExchangeTable,
} from '../platform/index.js';
import { completeOAuthCallback, OAUTH_EXCHANGES } from '../platform/index.js';
import type { PlatformAppConfig } from '../types/index.js';

/** design.md: 「`GET /install/{platform}/callback`」. */
export const installCallbackPath = (platform: PlatformName): string =>
  `/install/${platform}/callback`;

/** An install that did not complete, as the operator needs to read it. */
export interface InstallFailure {
  readonly platform: PlatformName;
  readonly reason: OAuthCallbackFailureReason;
  readonly detail: string;
}

export interface InstallRoutesDeps {
  readonly appConfig: PlatformAppConfig;
  /**
   * Narrowed with `Pick` the way every other route module narrows its own
   * dependency: a reader can see from the type that a callback cannot take an
   * installation apart, whatever it carries.
   */
  readonly installations: Pick<InstallationStore, 'save'>;
  /** See point 3 above. Not optional. */
  readonly onInstallFailed: (failure: InstallFailure) => void;
  /**
   * Which services install this way and how. Defaults to the declared table;
   * a caller may substitute one, which is what lets this module be exercised
   * without calling a chat service. Registration and dispatch both read THIS
   * value, so a route can never exist for a service with no exchange.
   */
  readonly exchanges?: OAuthExchangeTable;
  /** See `OAuthCallbackDeps.redirectUri`: only needed behind a TLS terminator. */
  readonly redirectUri?: string;
  readonly fetch?: typeof fetch;
}

/**
 * Generic in `E` for the reason `registerPairingRoutes` is (Implementation
 * Note 8.4): task 8.5 registers every module on one `Hono<SignedRequestEnv>`,
 * and a bare `Hono` parameter could not take it. These handlers read nothing
 * the guard puts on the context -- there is no guard in front of them.
 */
export const registerInstallRoutes = <E extends Env>(
  app: Hono<E>,
  deps: InstallRoutesDeps,
): void => {
  const exchanges = deps.exchanges ?? OAUTH_EXCHANGES;

  for (const platform of Object.keys(exchanges) as PlatformName[]) {
    app.get(installCallbackPath(platform), async (c) => {
      const result = await completeOAuthCallback(
        platform,
        c.req.raw,
        {
          appConfig: deps.appConfig,
          redirectUri: deps.redirectUri,
          fetch: deps.fetch,
        },
        exchanges,
      );

      if (!result.ok) {
        deps.onInstallFailed({
          platform,
          reason: result.reason,
          detail: result.detail,
        });
        return c.text(
          'The installation could not be completed. Ask the operator of this proxy to check its records, then open the install link again.',
          400,
        );
      }

      const { workspaceId, workspaceName, credentials } = result.installation;
      // Not caught: a storage failure has to become a 500 rather than a page
      // saying the install worked. The whole flow is safe to repeat -- the
      // operator opens the install link again -- and `save()` is an upsert on
      // `(platform, workspaceId)`.
      await deps.installations.save(
        platform,
        workspaceId,
        workspaceName,
        credentials,
      );

      return c.text(
        `${workspaceName} is now connected to this proxy. You can close this window and pair it with a GROWI from GROWI's admin screen.`,
        200,
      );
    });
  }
};
