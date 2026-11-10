// Public barrel for `routes/` -- the outermost layer of the dependency order
// design.md declares (`types -> ... -> orchestration -> routes`), so nothing
// inside the app imports from here; the composition point in `runtime/` does.
//
// Opened by task 8.1 with the signature guard alone. Task 8.2 added the
// notification and settings-push endpoints, task 8.3 the two key endpoints and
// the three read-only ones, task 8.4 the unsigned pairing submission, and task
// 8.5 the OAuth callback, the inbound webhook and the health check -- and with
// them `createRoutesApp`, the composed app that is what `runtime/` actually
// starts. The composition lives in `app.ts` rather than in this file: a barrel
// re-exports, it does not build (see that file's header).
//
// `INBOUND_OP_BY_PATH` is exported because the endpoints GROWI signs requests
// to have to be registered on exactly the paths it names -- reading the table
// is what keeps a route and the op its guard expects from drifting apart.
// `challenge-sender.ts` is deliberately absent: `createChallengeSender` is how
// `pairing-routes.ts` builds ONE exchange, not something another layer calls,
// and its own spec reaches it directly as a sibling. Same rule
// `relation/index.ts` records for `buildPinnedRequestOptions`.
export type { RoutesAppDeps } from './app.js';
export { createRoutesApp } from './app.js';
export type { HealthRoutesDeps } from './health-routes.js';
export { HEALTH_PATH, registerHealthRoutes } from './health-routes.js';
export type { InstallFailure, InstallRoutesDeps } from './install-routes.js';
export {
  installCallbackPath,
  registerInstallRoutes,
} from './install-routes.js';
export type { KeyRoutesDeps } from './key-routes.js';
export { registerKeyRoutes } from './key-routes.js';
export type { NotificationRoutesDeps } from './notification-routes.js';
export { registerNotificationRoutes } from './notification-routes.js';
export type { PairingRoutesDeps } from './pairing-routes.js';
export {
  PAIRING_SUBMIT_PATH,
  registerPairingRoutes,
} from './pairing-routes.js';
export type { ReadRoutesDeps } from './read-routes.js';
export { registerReadRoutes } from './read-routes.js';
export type {
  InboundRequestContext,
  SignatureGuardDeps,
  SignedRequestEnv,
  SignedRequestVariables,
} from './signature-guard.js';
export {
  INBOUND_OP_BY_PATH,
  pathForOp,
  signatureGuard,
} from './signature-guard.js';
export type { WebhookRoutesDeps } from './webhook-routes.js';
export { registerWebhookRoutes, webhookPath } from './webhook-routes.js';
