// Public barrel for `runtime/` -- the outermost layer (design.md's declared
// dependency order ends here; nothing imports this layer back). Only the
// startup entry point reads from it.
//
// `dependencies.ts`, `mattermost-installations.ts` and `sweeper.ts` are
// deliberately absent: all three exist for `server.ts` to call -- nothing
// outside this layer composes an object graph, declares an installation, or
// runs the periodic work -- and their own specs reach them as siblings.
export type {
  ClosedNetworkConfig,
  HttpConfig,
  MattermostInstallationConfig,
  ProxyConfig,
  SecretCipher,
} from './config.js';
export { loadConfig } from './config.js';
export type { RunningProxy, StartProxyOverrides } from './server.js';
export { runProxy, SHUTDOWN_SIGNALS, startProxy } from './server.js';
