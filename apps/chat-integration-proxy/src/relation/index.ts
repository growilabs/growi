// Public entry point of the `relation/` layer (design.md's File Structure
// Plan: 「この層の公開窓口」). Layers to the right of `relation/` import from
// here, never from the files below.
//
// Complete as of task 5.5, the last task of this layer: the five modules
// design.md lists under `relation/` are all built, and what is re-exported
// below is what `orchestration/` needs to hold them -- `GrowiUriResolver`,
// `RelationKeyService`, `GrowiSelector`, `PairingService`, and `UnpairService`
// -- plus the errors and the named limits a caller has to be able to name.
// Anything a module uses only on its own way to those (`buildPinnedRequestOptions`
// is the standing example) stays unexported on purpose.

export type {
  ExcludedGrowi,
  GrowiSelector,
  GrowiSelectorDeps,
  SelectionOutcome,
  SelectionRequest,
} from './growi-selection.js';
export { createGrowiSelector } from './growi-selection.js';
export type {
  ConnectResult,
  GrowiHttpRequest,
  GrowiHttpResponse,
  GrowiUriRejectionReason,
  GrowiUriResolver,
  GrowiUriResolverDeps,
  PinnedConnection,
  ResolveAddresses,
  ResolvedAddress,
} from './growi-uri-resolver.js';
// `buildPinnedRequestOptions` is deliberately absent from the PRODUCTION
// surface: it is how this layer builds one request, not something another
// layer calls at run time. It is not unreachable, though -- `growi/`'s
// `growi-client.spec.ts` imports it straight from `./growi-uri-resolver.js`
// so that "the GROWI base path is applied once, not twice" is checked against
// the real joining rule instead of one re-derived inside the test. A test
// reaching past a barrel is not a caller: re-exporting it here would widen
// what `orchestration/` and `routes/` may reach for, which is exactly what
// this barrel exists to hold down.
export {
  createGrowiUriResolver,
  GrowiRequestTimeoutError,
} from './growi-uri-resolver.js';
export type {
  PairingService,
  PairingServiceDeps,
  SendChallenge,
} from './pairing-service.js';
export {
  createPairingService,
  MAX_LIVE_PAIRING_ORDERS,
  MAX_SUBMISSION_ATTEMPTS,
  PairingOrderLimitError,
  REGISTRATION_CODE_TTL_MS,
} from './pairing-service.js';
export type {
  KeyDeliveryOutcome,
  RelationKeyService,
  RelationKeyServiceDeps,
  RotationResult,
  RotationStatus,
  SendKeyRegistration,
  SendKeyRevocation,
} from './relation-key-service.js';
export { createRelationKeyService } from './relation-key-service.js';
export type { UnpairService, UnpairServiceDeps } from './unpair-service.js';
export { createUnpairService } from './unpair-service.js';
