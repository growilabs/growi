// Public entry point for the end-to-end harness (tasks.md 11.1).
//
// TEST INFRASTRUCTURE, NOT PRODUCTION SURFACE. Nothing under `src/testing/` is
// reachable from shipped code: `src/index.ts` does not re-export it, and
// `tsconfig.build.json` keeps the whole directory out of `dist/`. It is also
// the one directory under `src/` that is outside the layer chain and may
// therefore import any layer -- see `architecture.spec.ts`.
//
// Kept to what tasks 11.2-11.5 call. `signing-identity.ts` is re-exported
// because both fakes are configured with the values it makes; every other
// internal stays unexported (`.claude/rules/coding-style.md`).
export {
  actionOn,
  actorOn,
  channelOn,
  interactionOn,
  linkPostedOn,
  mentionOn,
  modalSubmitOn,
} from './chat-events.js';
export type {
  CapturedModal,
  CapturedPost,
  CapturedPostKind,
  DeliveryOutcome,
  FakeChatScript,
  FakeChatService,
} from './fake-chat-service.js';
export { createFakeChatService } from './fake-chat-service.js';
export type {
  CallProxyParams,
  FakeGrowi,
  FakeGrowiOptions,
  FakeGrowiRefusal,
  FakeGrowiRequest,
  OpResponder,
  ProxyAnswer,
  ScriptedAnswer,
} from './fake-growi.js';
export { startFakeGrowi } from './fake-growi.js';
export type { FreePortListener } from './free-port.js';
export {
  LOOPBACK,
  listenOnFreePort,
  serveOnFreePort,
  whenListening,
} from './free-port.js';
export type {
  ProxyCluster,
  ProxyClusterDeps,
  ProxyInstance,
  ProxyInstanceSpec,
  StartProxyFn,
} from './proxy-cluster.js';
export { startProxyCluster } from './proxy-cluster.js';
export type { PeerKey, SigningIdentity } from './signing-identity.js';
export { createSigningIdentity } from './signing-identity.js';
