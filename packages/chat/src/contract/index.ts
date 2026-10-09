// Public barrel for `contract/` -- every wire-shape type this package
// declares. Client-safe (no `node:crypto`): re-exported from the top-level
// `src/index.ts`. See design.md's File Structure Plan and Components and
// Interfaces table for the intent of each file.

export type {
  AccountLinkStartRequest,
  AccountLinkStartResponse,
} from './account-link.js';
export type {
  CommandEnvelope,
  CommandRequest,
  CommandResponse,
  KeepMessage,
  ResponseKind,
  SearchResultItem,
} from './command.js';
export { RESPONSE_KINDS } from './command.js';
export type {
  ChannelRef,
  ChatAccountRef,
  MessageRef,
  PlatformName,
} from './common.js';
export type {
  NotificationRequest,
  NotificationResult,
} from './notification.js';
export type {
  ChallengeResponse,
  KeyOperationResult,
  KeyRegistrationRequest,
  KeyRevocationRequest,
  OwnershipChallenge,
  PairingResult,
  PairingSubmission,
  PublicKeyRegistration,
  PublicKeySet,
} from './pairing.js';
export type {
  CapabilityLevel,
  CapabilityReport,
  ChannelInventory,
  ConnectionHealth,
  ConnectionStatusView,
  RelationSettings,
  SettingsPullResponse,
  SettingsPushRequest,
} from './settings.js';
