import { isChatIntegrationPeerPath } from '../../features/chat-integration/server/is-peer-path';

/**
 * Request paths that must not reach the app-wide session middleware, as
 * predicates over `req.path`.
 *
 * @type {ReadonlyArray<(path: string) => boolean>}
 */
export default [
  (path) => /^\/api-docs\//.test(path),
  // The chat-integration proxy endpoints are machine-to-machine: they carry no
  // cookie and never read a session, yet the app-wide session is configured
  // with `saveUninitialized`, so a session document would be written for every
  // request -- including the ones the unsigned pairing-challenge endpoint
  // rejects for exceeding its attempt limit. The matcher is shared with
  // crowi/express-init.js's other exclusions so the two cannot drift apart --
  // see features/chat-integration/server/is-peer-path.ts.
  isChatIntegrationPeerPath,
];
