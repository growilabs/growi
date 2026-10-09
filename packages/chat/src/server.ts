// Server-only public entry point for @growi/chat.
//
// This module may use `node:crypto` (RFC 9421 signature generation and
// verification) -- callers that import from here (the GROWI server, the
// proxy server) are never bundled for a browser. Client-safe exports
// (contract types, command names, permission judgement) live in
// `./index.ts` instead; see `src/public-surface.spec.ts` for the drift test
// that keeps `./index.ts` from reaching this module's dependencies.
//
// Everything below comes from the `./signature` directory barrel -- see
// that file's header comment for what was deliberately left out
// (`buildSignatureBase`, `structured-fields.ts`'s serialize/parse helpers)
// and why.

export type {
  CoveredComponent,
  KeyMaterialJudgement,
  KeyRef,
  KeyRevocationJudgement,
  RevocableKeyEntry,
  SignatureParamName,
  SignParams,
  SignResult,
  VerifyFailure,
  VerifyParams,
  VerifyResult,
} from './signature/index.js';
export {
  acceptEnvelope,
  CLOCK_SKEW_TOLERANCE_SEC,
  CONTENT_DIGEST_ALGORITHM,
  COVERED_COMPONENTS,
  computeContentDigest,
  DEFAULT_EXPIRES_IN_SEC,
  decodeKeyId,
  encodeKeyId,
  isValidKeyIdShape,
  isValidPublicKeyMaterial,
  judgeKeyRevocation,
  MAX_ACCEPTED_EXPIRES_IN_SEC,
  pairingChallengePayload,
  SIGNATURE_ALGORITHM,
  SIGNATURE_LABEL,
  SIGNATURE_PARAMS,
  sign,
  verify,
} from './signature/index.js';
