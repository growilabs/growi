// The health check, and the place Requirement 13.3 is answered: **「接続元を
// 限定するために必要な情報を運用者に示せる形にする」** -- putting into a form
// an operator can read what has to be let in from outside, and what to narrow
// its source addresses to.
//
// **Why the health check and not a new endpoint, a log line, or a comment.**
// The information is a fact about the running deployment, not about the source
// tree: which services need an inbound hole follows from
// `REQUIRES_INBOUND_REACHABILITY`, and which path to open follows from what
// `webhook-routes.ts` actually registered from that same table. A doc comment
// would be read once and could not go stale visibly; a startup log line is gone
// by the time the operator is writing the firewall rule; a separate endpoint
// would be one more thing to route and to decide the exposure of. The health
// check is already the endpoint an operator points at a running proxy, and it
// is the one place design.md itself suggests for information of this kind
// (「運用者が見たいなら proxy のログか `health` に置く」).
//
// **What it deliberately does not carry.** No count of installations,
// relations or paired GROWIs. design.md sanctions `health` for that count only
// on the assumption it is operator-only, and this endpoint has no
// authentication of its own -- so it stays out. Excluding it is the smaller
// commitment; it can be added by whoever gives `health` an auth posture.
//
// **Addresses are named as a source to look up, never listed.** Microsoft
// publishes the Azure Bot Service ranges and changes them; a copy pasted into
// this file would rot silently while nothing went red.
import type { PlatformName } from '@growi/chat';
import type { Env, Hono } from 'hono';

import { webhookPath } from './webhook-routes.js';

export const HEALTH_PATH = '/health';

/**
 * What to narrow the source of an inbound connection to, per service.
 *
 * An empty string means "this service needs no inbound hole", which is the
 * answer for every service this proxy dials itself.
 * `health-routes.spec.ts` checks this against
 * `REQUIRES_INBOUND_REACHABILITY`, so a service that gains an inbound path
 * without gaining guidance here fails rather than answering an empty string to
 * an operator asking what to allow.
 */
export const INBOUND_SOURCE_GUIDANCE: Readonly<Record<PlatformName, string>> = {
  slack: '',
  discord: '',
  teams:
    'Allow only Azure Bot Service. On Azure, use the AzureBotService service tag; elsewhere, take its current ranges from the Azure IP Ranges and Service Tags file Microsoft publishes -- they change, so track the file rather than copying addresses.',
  mattermost: '',
};

export interface HealthRoutesDeps {
  /** `REQUIRES_INBOUND_REACHABILITY`, the same value `webhook-routes.ts` takes. */
  readonly reachability: Readonly<Record<PlatformName, boolean>>;
}

/** Generic in `E` for the reason `registerInstallRoutes` is. */
export const registerHealthRoutes = <E extends Env>(
  app: Hono<E>,
  deps: HealthRoutesDeps,
): void => {
  app.get(HEALTH_PATH, (c) =>
    c.json({
      status: 'ok',
      // One row per service that must be reachable from outside; empty when
      // this deployment needs no inbound hole at all.
      inboundExposure: (Object.keys(deps.reachability) as PlatformName[])
        .filter((platform) => deps.reachability[platform])
        .map((platform) => ({
          platform,
          path: webhookPath(platform),
          restrictSourceTo: INBOUND_SOURCE_GUIDANCE[platform],
        })),
    }),
  );
};
