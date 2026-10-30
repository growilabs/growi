// The one composed app: every endpoint this proxy serves, mounted in one
// place -- tasks.md 8.5's 「この層の入口もここでまとめる」.
//
// **Why composition is a file of its own rather than `index.ts`.** `index.ts`
// is this layer's barrel, and every other barrel in this app is re-exports
// only. Building a value there would make the layer's public surface and its
// wiring the same file, and `routes/app.spec.ts` -- which drives a real app --
// would then be importing the barrel to test something the barrel is not.
//
// **The app is `Hono<SignedRequestEnv>`.** Three of the seven registrars need
// that environment for `c.get('verifiedKey')`; the other four are generic in
// their environment (Implementation Note 8.4 records why that shape was chosen)
// and take it unchanged. No cast anywhere.
//
// **Nothing is constructed here.** Every dependency arrives already built --
// `runtime/` owns configuration, repositories and the platform facade. This
// function only decides what is mounted, which is what
// `routes/app.spec.ts`'s guard sweep can then check against a real app rather
// than against a wiring the test wrote itself.
import { Hono } from 'hono';

import { registerHealthRoutes } from './health-routes.js';
import type { InstallRoutesDeps } from './install-routes.js';
import { registerInstallRoutes } from './install-routes.js';
import type { KeyRoutesDeps } from './key-routes.js';
import { registerKeyRoutes } from './key-routes.js';
import type { NotificationRoutesDeps } from './notification-routes.js';
import { registerNotificationRoutes } from './notification-routes.js';
import type { PairingRoutesDeps } from './pairing-routes.js';
import { registerPairingRoutes } from './pairing-routes.js';
import type { ReadRoutesDeps } from './read-routes.js';
import { registerReadRoutes } from './read-routes.js';
import type { SignedRequestEnv } from './signature-guard.js';
import type { WebhookRoutesDeps } from './webhook-routes.js';
import { registerWebhookRoutes } from './webhook-routes.js';

export interface RoutesAppDeps {
  readonly notification: NotificationRoutesDeps;
  readonly key: KeyRoutesDeps;
  readonly read: ReadRoutesDeps;
  readonly pairing: PairingRoutesDeps;
  readonly install: InstallRoutesDeps;
  readonly webhook: Omit<WebhookRoutesDeps, 'reachability'>;
  /**
   * `REQUIRES_INBOUND_REACHABILITY` (`capabilities/`), taken ONCE and handed to
   * both the webhook routes and the health check.
   *
   * **This is the one thing this function does construct, and deliberately.**
   * The webhook routes open a path per service that needs an inbound hole; the
   * health check tells the operator which paths those are. Two separate fields
   * would let a wiring pass different tables, and health would then advertise a
   * path nothing serves -- or stay silent about one that is open. One field
   * makes that impossible rather than merely detectable.
   */
  readonly reachability: WebhookRoutesDeps['reachability'];
}

export const createRoutesApp = (
  deps: RoutesAppDeps,
): Hono<SignedRequestEnv> => {
  const app = new Hono<SignedRequestEnv>();

  // The body cap is NOT here: it stands in front of this whole app, in
  // `runtime/server.ts`'s `createProxyApp`. `signatureGuard` reads the body
  // into memory before the signature can be checked (it has to -- the signature
  // covers the bytes), so the cap has to run before every endpoint including
  // the unsigned ones, and its size is configuration this layer cannot see.

  // Each module builds its own `signatureGuard` from `SignatureGuardDeps`
  // (Implementation Note 8.2): mounting a ready-made middleware here would make
  // "this endpoint is guarded" a property of this file rather than of the
  // endpoint, and `app.spec.ts` would then be checking this file's wiring.
  registerNotificationRoutes(app, deps.notification);
  registerKeyRoutes(app, deps.key);
  registerReadRoutes(app, deps.read);

  // Unsigned by construction, each for its own reason -- see the header of each
  // module.
  registerPairingRoutes(app, deps.pairing);
  registerInstallRoutes(app, deps.install);
  registerWebhookRoutes(app, {
    ...deps.webhook,
    reachability: deps.reachability,
  });
  registerHealthRoutes(app, { reachability: deps.reachability });

  return app;
};
