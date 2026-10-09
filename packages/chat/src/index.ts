// Client-safe public entry point for @growi/chat.
//
// This module must never statically reach `node:crypto` (or any other
// server-only dependency) -- the admin screen (Requirements 1.3 / 11 / 12.5)
// imports from here, so anything exported here is pulled into the client
// bundle. RFC 9421 signature generation/verification lives in `./server.ts`
// instead; see `src/public-surface.spec.ts` for the drift test that enforces
// this split.
//
// Re-exports, one per directory barrel: contract types (`./contract`), the
// command-name vocabulary (`./commands`), the endpoint vocabulary
// (`./endpoints`), the channel-permission judgement (`./permission`), the
// declared-URL judgement (`./url-guard`), and the wire-shape check
// functions (`./parse`).

export type {
  CommandName,
  CommandTargeting,
  CommandTraits,
} from './commands/index.js';
export {
  COMMAND_NAMES,
  COMMAND_TRAITS,
  isWriteCommand,
  targetingOf,
} from './commands/index.js';
export type {
  AccountLinkStartRequest,
  AccountLinkStartResponse,
  CapabilityLevel,
  CapabilityReport,
  ChallengeResponse,
  ChannelInventory,
  ChannelRef,
  ChatAccountRef,
  CommandEnvelope,
  CommandRequest,
  CommandResponse,
  ConnectionHealth,
  ConnectionStatusView,
  KeepMessage,
  KeyOperationResult,
  KeyRegistrationRequest,
  KeyRevocationRequest,
  MessageRef,
  NotificationRequest,
  NotificationResult,
  OwnershipChallenge,
  PairingResult,
  PairingSubmission,
  PlatformName,
  PublicKeyRegistration,
  PublicKeySet,
  RelationSettings,
  ResponseKind,
  SearchResultItem,
  SettingsPullResponse,
  SettingsPushRequest,
} from './contract/index.js';
export { RESPONSE_KINDS } from './contract/index.js';
export type {
  OpDirection,
  OpEndpointDescriptor,
  OpName,
  OpOnlyRequest,
  RequestEnvelope,
} from './endpoints/index.js';
export { OP_ENDPOINTS, OP_NAMES } from './endpoints/index.js';
export {
  parseAccountLinkStart,
  parseAccountLinkStartResponse,
  parseCapabilityReport,
  parseChallengeResponse,
  parseChannelInventory,
  parseCommandRequest,
  parseCommandResponse,
  parseConnectionStatusView,
  parseKeyOperationResult,
  parseKeyRegistration,
  parseKeyRevocation,
  parseNotificationRequest,
  parseNotificationResult,
  parseOpEnvelope,
  parseOwnershipChallenge,
  parsePairingResult,
  parsePairingSubmission,
  parseSettingsPullResponse,
  parseSettingsPush,
} from './parse/index.js';
export type { BroadcastTarget, PermissionVerdict } from './permission/index.js';
export { filterBroadcastTargets, judge } from './permission/index.js';
export type { UriVerdict } from './url-guard/index.js';
export { judgeGrowiUri } from './url-guard/index.js';
