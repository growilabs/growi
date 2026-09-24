// The pairing procedure's wire types (Requirement 9), plus the key
// add/revoke round trip that flows both directions once a relation exists
// (Requirement 10.5, 10.6). Same treatment as command.ts/notification.ts
// (tasks 3.1/3.2): pure types, no runtime logic. `keyId` here is a raw,
// caller-assigned name -- it is unique only within a relation and carries
// no composition with `KeyRef`/`encodeKeyId` from key-identity.ts (task
// 2.4); that module's job starts once a `relationId` is known, which these
// contract types don't need to express.

import type { OP_NAMES, RequestEnvelope } from '../endpoints/op-names.js';
import type { PlatformName } from './common.js';

/**
 * Public key. **The registering side MUST validate it.** `JsonWebKey` is a
 * broad type that also accepts elliptic curves, RSA, or symmetric keys, so
 * accepting it as-is would let an unintended key type register. All of the
 * following must hold:
 *   - `kty` is `'OKP'`, `crv` is `'Ed25519'`
 *   - MUST NOT contain a private/secret component (`d`)
 */
export interface PublicKeyRegistration {
  /** Assigned by the key's owner. Unique WITHIN the relation (see key-identity.ts). */
  readonly keyId: string;
  readonly publicKeyJwk: JsonWebKey;
  readonly validFrom: string;
}

export interface PublicKeySet {
  readonly keys: ReadonlyArray<
    PublicKeyRegistration & { readonly revokedAt: string | null }
  >;
}

/**
 * GROWI -> proxy. Sent when an admin enters a registration code into
 * GROWI (pairing step 3). NO signature -- this is one of the two unsigned
 * entry points (the other is `OwnershipChallenge`'s response), because no
 * key exists yet at this point in the procedure.
 */
export interface PairingSubmission {
  readonly registrationCode: string;
  /**
   * Freely written by the submitting side. MUST be validated (scheme,
   * port, resolved-address private-range check, allowList) before proxy
   * sends anything to it -- see design.md's "申告された URL を検証する"
   * section; that validation is `@growi/chat`'s `url-guard` (task 4.2),
   * not this contract type.
   */
  readonly growiUri: string;
  readonly growiLabel: string;
  /** GROWI's own public key is submitted here. */
  readonly publicKey: PublicKeyRegistration;
}

export type PairingResult =
  | {
      readonly status: 'paired';
      readonly relationId: string;
      /** Used for Requirement 12.4's overlap judgement. */
      readonly workspace: {
        readonly platform: PlatformName;
        readonly workspaceId: string;
        readonly workspaceName: string;
      };
      /** proxy's own public key is returned here. */
      readonly publicKey: PublicKeyRegistration;
    }
  | { readonly status: 'code-expired' } // Requirement 9.1, 9.4
  | { readonly status: 'ownership-unverified'; readonly detail: string } // Requirement 9.3
  | { readonly status: 'already-paired'; readonly detail: string }; // Requirement 8.5

/** proxy -> the declared `growiUri` (pairing step 4). */
export interface OwnershipChallenge {
  readonly registrationCode: string;
  /** Generated fresh by proxy for this exchange, single-use. base64url ONLY. */
  readonly challenge: string;
}

/**
 * GROWI -> proxy (pairing step 5). Returned ONLY while the registration
 * code named by `OwnershipChallenge` is still pending and matches --
 * otherwise GROWI answers 401 (mismatch) or 410 (expired), not this shape.
 */
export interface ChallengeResponse {
  readonly challenge: string;
  /**
   * Signature (base64url-encoded) over the "value to sign" (see
   * design.md's `pairingChallengePayload` -- that composition, and its
   * verification, are task 5.4's job, not this contract type), using the
   * private key submitted in pairing step 3. Without this, ownership
   * confirmation only proves "someone at that URL knows the registration
   * code", not "the public key submitted in step 3 belongs to that party".
   */
  readonly challengeSignature: string;
}

/**
 * Ask the peer to add a new public key. Flows BOTH directions (proxy ->
 * GROWI and GROWI -> proxy). Pairing only exchanges the first key pair;
 * this is the path to add more later. Without this, Requirement 10.5
 * (rotate without downtime) cannot be satisfied.
 */
export interface KeyRegistrationRequest extends RequestEnvelope {
  readonly op:
    | typeof OP_NAMES.keyRegisterToGrowi
    | typeof OP_NAMES.keyRegisterToProxy;
  readonly key: PublicKeyRegistration;
}

export interface KeyRevocationRequest extends RequestEnvelope {
  readonly op:
    | typeof OP_NAMES.keyRevokeToGrowi
    | typeof OP_NAMES.keyRevokeToProxy;
  readonly keyId: string;
}

export type KeyOperationResult =
  | { readonly status: 'ok' }
  | {
      readonly status: 'rejected';
      readonly reason:
        | 'would-leave-no-valid-key'
        | 'unknown-key'
        | 'invalid-key';
    };
