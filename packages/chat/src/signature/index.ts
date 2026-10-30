// Public barrel for `signature/` -- server-only (reaches `node:crypto`
// transitively via `sign.ts`/`verify.ts`). Re-exported from the top-level
// `src/server.ts` ONLY; must never be reachable from `src/index.ts`
// (`src/public-surface.spec.ts` enforces this).
//
// Deliberately NOT re-exported here (pure implementation detail, called
// only from within this directory, per the task's "leave out unless a
// concrete consumer need appears"):
// - `signature-base.ts`'s `buildSignatureBase` (+ its `SignatureParamValue`/
//   `SignatureParams`/`SignatureBaseMessage` types): internal to `sign.ts`/
//   `verify.ts`.
// - `structured-fields.ts`: this package's one contact point with the
//   untyped `structured-headers` library, consumed only by
//   `content-digest.ts`/`signature-base.ts`.

export { acceptEnvelope } from './accept-envelope.js';
export {
  CONTENT_DIGEST_ALGORITHM,
  computeContentDigest,
} from './content-digest.js';
export type { CoveredComponent } from './covered-components.js';
export { COVERED_COMPONENTS } from './covered-components.js';
export type { KeyRef } from './key-identity.js';
export { decodeKeyId, encodeKeyId, isValidKeyIdShape } from './key-identity.js';
export type { KeyMaterialJudgement } from './key-material.js';
export { isValidPublicKeyMaterial } from './key-material.js';
export type {
  KeyRevocationJudgement,
  RevocableKeyEntry,
} from './key-revocation.js';
export { judgeKeyRevocation } from './key-revocation.js';
export { pairingChallengePayload } from './pairing-challenge.js';
export type { SignParams, SignResult } from './sign.js';
export { DEFAULT_EXPIRES_IN_SEC, SIGNATURE_LABEL, sign } from './sign.js';
export type { SignatureParamName } from './signature-params.js';
export { SIGNATURE_ALGORITHM, SIGNATURE_PARAMS } from './signature-params.js';
export type { VerifyFailure, VerifyParams, VerifyResult } from './verify.js';
export {
  CLOCK_SKEW_TOLERANCE_SEC,
  MAX_ACCEPTED_EXPIRES_IN_SEC,
  verify,
} from './verify.js';
