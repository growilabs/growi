// Public barrel for `db/repositories/` -- the only import point the rest of
// the storage layer (and, through `db/index.ts`, every layer above it) uses.
// Task 2.3's job (design.md's File Structure Plan): tasks 2.1 and 2.2 built the
// ten repository files below but deliberately left this barrel for this task.
//
// `test-cipher.ts` is NOT re-exported: it is a test fixture (excluded from
// `tsconfig.build.json` alongside `*.spec.ts` / `*.integ.ts`), not part of this
// layer's public contract.

export type {
  ChannelPermissionRepository,
  PermittedChannels,
} from './channel-permission-repository.js';
export { createChannelPermissionRepository } from './channel-permission-repository.js';
export type {
  InstallationChannelRecord,
  InstallationChannelRepository,
} from './installation-channel-repository.js';
export { createInstallationChannelRepository } from './installation-channel-repository.js';
export type {
  InstallationRecord,
  InstallationRepository,
} from './installation-repository.js';
export { createInstallationRepository } from './installation-repository.js';
export type {
  NewOwnKey,
  OwnKeyRecord,
  OwnKeyRepository,
} from './own-key-repository.js';
export { createOwnKeyRepository } from './own-key-repository.js';
export type {
  PairingOrderRecord,
  PairingOrderRepository,
} from './pairing-order-repository.js';
export { createPairingOrderRepository } from './pairing-order-repository.js';
export type { PeerKeyRepository } from './peer-key-repository.js';
export { createPeerKeyRepository } from './peer-key-repository.js';
export type {
  NewPendingCollection,
  PendingCollectionRecord,
  PendingCollectionRepository,
  PendingCollectionUpdate,
} from './pending-collection-repository.js';
export { createPendingCollectionRepository } from './pending-collection-repository.js';
export type {
  ProcessedNotificationRepository,
  ProcessedNotificationTargetRecord,
} from './processed-notification-repository.js';
export { createProcessedNotificationRepository } from './processed-notification-repository.js';
export type {
  NewRelation,
  RelationRepository,
} from './relation-repository.js';
export {
  createRelationRepository,
  RelationAlreadyExistsError,
} from './relation-repository.js';
export type { RequestNonceRepository } from './request-nonce-repository.js';
export { createRequestNonceRepository } from './request-nonce-repository.js';
