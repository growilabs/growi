// Public barrel for `capabilities/` -- the only import point other layers
// use (design.md's declared dependency order:
// `types -> capabilities -> db -> platform -> command -> relation -> growi
// -> orchestration -> routes`).

export type { AdminCheckMethod } from './admin-check.js';
export { ADMIN_CHECK_TABLE } from './admin-check.js';
// `CapabilityLevel` is NOT re-exported here -- it is owned by `@growi/chat`
// (this app's proxy-specific `platform-capabilities.ts` imports it from
// there rather than redeclaring it). Consumers should import it directly
// from `@growi/chat`, not through this barrel, so there is exactly one
// import path for it.
export type {
  CapabilityName,
  ConnectionUnit,
} from './platform-capabilities.js';
export {
  buildCapabilityReport,
  CAPABILITY_SUBSTITUTE,
  CAPABILITY_TABLE,
  CONNECTION_UNIT_TABLE,
  levelOf,
  REQUIRES_INBOUND_REACHABILITY,
  supports,
} from './platform-capabilities.js';
