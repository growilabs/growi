// The way in for a chat service that dials this proxy instead of the other way
// round -- Teams, and only Teams (design.md's 閉域 section: 「外部から通す必要
// があるのは Teams だけ」; Requirement 13.3).
//
// **Which services get a route is read from
// `REQUIRES_INBOUND_REACHABILITY`**, the table `capabilities/` already declares,
// rather than from a service name written here. That table is also what the
// health check reports to the operator, so what this proxy actually opens and
// what it tells an operator to open cannot say different things.
//
// **The handler is deliberately nothing but a pass-through.** It hands the
// request to `PlatformFacade.webhookHandler(platform)` and returns what comes
// back untouched -- status, headers and body. Teams answers an invoke with a
// body the service reads (a dialog, an acknowledgement whose shape matters),
// and re-wrapping it here would be a second place for that shape to be got
// wrong. The Chat SDK stays behind `platform/`: `webhookHandler` is already
// `(request: Request) => Promise<Response>` in this app's own vocabulary.
//
// **`signatureGuard` is not mounted, and must not be.** The guard verifies a
// GROWI's RFC 9421 signature against that relation's `peer_key`; the caller
// here is Azure Bot Service, which has no relation and no key, and this path
// is absent from `INBOUND_OP_BY_PATH`, so the guard would refuse every activity
// with a 401. What authenticates a Teams activity is the bearer token the Bot
// Framework puts on it, which travels with the request into the adapter.
// **Not verified here, and not verified by this proxy at all** -- see this
// task's Implementation Note; adding a second, home-made check in front of the
// adapter would be the wrong place for it.
import type { PlatformName } from '@growi/chat';
import type { Env, Hono } from 'hono';

import type { PlatformFacade } from '../platform/index.js';

/** One path per service, named after the service that calls it. */
export const webhookPath = (platform: PlatformName): string =>
  `/webhook/${platform}`;

export interface WebhookRoutesDeps {
  readonly platform: Pick<PlatformFacade, 'webhookHandler'>;
  /**
   * `REQUIRES_INBOUND_REACHABILITY` (`capabilities/`). Taken as an argument
   * rather than imported for the reason `ReadRoutesDeps.units` is: the health
   * check reports the same table, and two independently-sourced copies could
   * disagree about which port an operator has to open.
   */
  readonly reachability: Readonly<Record<PlatformName, boolean>>;
}

/** Generic in `E` for the reason `registerInstallRoutes` is. */
export const registerWebhookRoutes = <E extends Env>(
  app: Hono<E>,
  deps: WebhookRoutesDeps,
): void => {
  const inbound = (Object.keys(deps.reachability) as PlatformName[]).filter(
    (platform) => deps.reachability[platform],
  );

  for (const platform of inbound) {
    const handle = deps.platform.webhookHandler(platform);
    app.post(webhookPath(platform), (c) => handle(c.req.raw));
  }
};
