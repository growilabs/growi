// Public barrel for `parse/` -- the wire-shape check functions ("parse*")
// that both sides of the protocol must use so a malformed or drifted body
// is rejected identically on either side (design.md "両側が同じ関数を使う").
//
// Deliberately NOT re-exported here:
// - `shape.ts` (`isRecord`/`str`/`arr`/`oneOf`): hand-written primitives the
//   parse* functions are built FROM, not request/response checkers
//   themselves (design.md "parse/ を手書きにする理由と、その作り方").
// - `common-fields.ts` (`PLATFORM_NAMES`/`parseChatAccountRef`/
//   `parseChannelRef`/`parsePublicKeyRegistration`): its own header comment
//   states it is "NOT part of any public barrel" -- shared internals for
//   two-or-more parse* functions, not a standalone contract checker.
// - `parse-settings.ts`'s `parseVersion`/`parseRelationSettings`: a field-
//   level and a sub-object checker consumed only by `parseSettingsPush` and
//   `parseSettingsPullResponse` (both exported below), the same "shared
//   internal, not a standalone checker" role as `common-fields.ts`.
export { parseCommandRequest, parseCommandResponse } from './parse-command.js';
export { parseOpEnvelope } from './parse-envelope.js';
export { parseKeyRegistration, parseKeyRevocation } from './parse-keys.js';
export {
  parseNotificationRequest,
  parseNotificationResult,
} from './parse-notification.js';
export {
  parseChallengeResponse,
  parseOwnershipChallenge,
  parsePairingSubmission,
} from './parse-pairing.js';
export {
  parseAccountLinkStartResponse,
  parseCapabilityReport,
  parseChannelInventory,
  parseConnectionStatusView,
  parseKeyOperationResult,
  parsePairingResult,
  parseSettingsPullResponse,
} from './parse-responses.js';
export { parseAccountLinkStart, parseSettingsPush } from './parse-settings.js';
