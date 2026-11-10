import { describe, expect, it } from 'vitest';

import { OP_NAMES } from '../endpoints/op-names.js';
import type {
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

// This spec has no runtime behavior to assert (task 3.3 declares pure
// types, same treatment as tasks 3.1/3.2's command.spec.ts /
// notification.spec.ts). Its purpose is to catch shape mistakes and to
// prove -- structurally, at compile time -- that design.md's pairing
// procedure (steps 1-6) is fully representable by these types.

// --- The six-step pairing procedure, mapped to the types below ---
//
// (1) proxy issues a registration code (chat admin command). Proxy-internal
//     only -- no wire type crosses this spec's boundary for this step.
// (2) The admin pastes the code into GROWI. GROWI holds it as a "pending
//     registration code" -- also proxy/app-internal state, no wire type here.
// (3) GROWI -> proxy: `PairingSubmission` (registrationCode, growiUri,
//     growiLabel, and GROWI's own `PublicKeyRegistration`).
// (4) proxy -> GROWI (at the declared `growiUri`): `OwnershipChallenge`
//     (registrationCode + a freshly generated challenge).
// (5) GROWI -> proxy: `ChallengeResponse` (the same challenge plus a
//     `challengeSignature` made with the private key submitted in step 3),
//     but ONLY when the registration code is still pending and matches.
// (6) proxy verifies the challenge/signature and returns `PairingResult`,
//     either `paired` (carrying `relationId`, proxy's own
//     `PublicKeyRegistration`, and `workspace`) or one of the three
//     rejection variants (`code-expired`, `ownership-unverified`,
//     `already-paired`).

describe('pairing procedure steps 3-6 (Requirement 9.1, 9.3, 9.4, 9.5)', () => {
  it("step 3: PairingSubmission carries the registration code, the declared GROWI URL/label, and GROWI's public key, unsigned", () => {
    const publicKey: PublicKeyRegistration = {
      keyId: 'growi-key-1',
      publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: 'base64url-x' },
      validFrom: '2026-09-01T00:00:00.000Z',
    };
    const submission: PairingSubmission = {
      registrationCode: 'code-abc',
      growiUri: 'https://growi.example.com',
      growiLabel: 'Team Wiki',
      publicKey,
    };
    expect(submission.publicKey).toBe(publicKey);
    // The type has no signature field -- step 3 is the unsigned entry
    // point (design.md: "pairing/submit は proxy 側の署名の付かない入口").
    expect('signature' in submission).toBe(false);
  });

  it('step 4: OwnershipChallenge carries only the registration code and a fresh challenge, no sender identity', () => {
    const challenge: OwnershipChallenge = {
      registrationCode: 'code-abc',
      challenge: 'YWJjZGVmZ2hpams', // base64url, single-use
    };
    // Deliberately no field naming the sender (design.md: "OwnershipChallenge
    // に送り主を示す値は入っていない") -- a probe against accidentally adding one.
    expect(Object.keys(challenge).sort()).toEqual([
      'challenge',
      'registrationCode',
    ]);
  });

  it('step 5: ChallengeResponse echoes the challenge with a signature made from the key submitted in step 3', () => {
    const response: ChallengeResponse = {
      challenge: 'YWJjZGVmZ2hpams',
      challengeSignature: 'c2lnbmF0dXJl',
    };
    expect(response.challenge).toBe('YWJjZGVmZ2hpams');
    expect(typeof response.challengeSignature).toBe('string');
  });

  it('step 6 (success): PairingResult "paired" carries relationId, the workspace overlap-judgement info, and proxy\'s public key', () => {
    const proxyKey: PublicKeyRegistration = {
      keyId: 'proxy-key-1',
      publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: 'base64url-y' },
      validFrom: '2026-09-01T00:00:00.000Z',
    };
    const result: PairingResult = {
      status: 'paired',
      relationId: 'rel-1',
      workspace: {
        platform: 'slack',
        workspaceId: 'W1',
        workspaceName: 'Acme Corp',
      },
      publicKey: proxyKey,
    };
    if (result.status !== 'paired') {
      throw new Error('unreachable');
    }
    expect(result.relationId).toBe('rel-1');
    expect(result.workspace.platform).toBe('slack');
    expect(result.publicKey).toBe(proxyKey);
  });

  it('step 6 (rejection): code-expired, ownership-unverified, and already-paired are distinguished (Requirement 9.1, 9.3, 9.4, 8.5)', () => {
    const expired: PairingResult = { status: 'code-expired' };
    const unverified: PairingResult = {
      status: 'ownership-unverified',
      detail: 'challenge signature did not verify',
    };
    const alreadyPaired: PairingResult = {
      status: 'already-paired',
      detail: 'this GROWI is already paired with this workspace',
    };

    const statuses = [expired, unverified, alreadyPaired].map((r) => r.status);
    expect(new Set(statuses).size).toBe(3);
    // `already-paired` must be its own variant, not folded into
    // `ownership-unverified` -- Requirement 8.5 is a distinct rejection
    // reason ("already linked"), not a failed identity check.
    expect(statuses).toContain('already-paired');
  });

  it('cannot assign a PairingResult status outside the declared vocabulary (structural probe)', () => {
    const buildWithUnknownStatus = (): PairingResult => {
      // @ts-expect-error -- 'unknown-status' is not one of the four declared PairingResult variants
      const bogus: PairingResult = { status: 'unknown-status' };
      return bogus;
    };
    expect(typeof buildWithUnknownStatus).toBe('function');
  });
});

describe('PublicKeyRegistration / PublicKeySet (Requirement 9.5)', () => {
  it('PublicKeySet tracks revocation per key without removing the record (Requirement 10.6)', () => {
    const set: PublicKeySet = {
      keys: [
        {
          keyId: 'key-1',
          publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: 'x1' },
          validFrom: '2026-01-01T00:00:00.000Z',
          revokedAt: null,
        },
        {
          keyId: 'key-2',
          publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: 'x2' },
          validFrom: '2026-02-01T00:00:00.000Z',
          revokedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    };
    expect(set.keys).toHaveLength(2);
    expect(set.keys.find((k) => k.keyId === 'key-2')?.revokedAt).not.toBeNull();
    expect(set.keys.find((k) => k.keyId === 'key-1')?.revokedAt).toBeNull();
  });
});

describe('KeyRegistrationRequest / KeyRevocationRequest (Requirement 10.5, 10.6)', () => {
  it('KeyRegistrationRequest flows both directions via distinct op values sharing the same body shape', () => {
    const toGrowi: KeyRegistrationRequest = {
      relationId: 'rel-1',
      op: OP_NAMES.keyRegisterToGrowi,
      key: {
        keyId: 'new-key',
        publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: 'x3' },
        validFrom: '2026-09-01T00:00:00.000Z',
      },
    };
    const toProxy: KeyRegistrationRequest = {
      relationId: 'rel-1',
      op: OP_NAMES.keyRegisterToProxy,
      key: {
        keyId: 'new-key-2',
        publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: 'x4' },
        validFrom: '2026-09-01T00:00:00.000Z',
      },
    };
    expect(toGrowi.op).not.toBe(toProxy.op);
    expect(toGrowi.key.keyId).toBe('new-key');
  });

  it('KeyRevocationRequest identifies the key to revoke by keyId only, both directions', () => {
    const revoke: KeyRevocationRequest = {
      relationId: 'rel-1',
      op: OP_NAMES.keyRevokeToProxy,
      keyId: 'old-key',
    };
    expect(revoke.keyId).toBe('old-key');
  });

  it('KeyOperationResult rejects with a reason distinguishing "would leave no valid key" from "unknown key" and "invalid key" (Requirement 10.5, 10.6)', () => {
    const ok: KeyOperationResult = { status: 'ok' };
    const noValidKeyLeft: KeyOperationResult = {
      status: 'rejected',
      reason: 'would-leave-no-valid-key',
    };
    const unknownKey: KeyOperationResult = {
      status: 'rejected',
      reason: 'unknown-key',
    };
    const invalidKey: KeyOperationResult = {
      status: 'rejected',
      reason: 'invalid-key',
    };

    expect(ok.status).toBe('ok');
    const reasons = [noValidKeyLeft, unknownKey, invalidKey].map(
      (r) => r.reason,
    );
    expect(new Set(reasons).size).toBe(3);
  });

  it('cannot assign a KeyOperationResult rejection reason outside the declared vocabulary (structural probe)', () => {
    const buildWithUnknownReason = (): KeyOperationResult => {
      const bogus: KeyOperationResult = {
        status: 'rejected',
        // @ts-expect-error -- 'made-up-reason' is not one of the three declared rejection reasons
        reason: 'made-up-reason',
      };
      return bogus;
    };
    expect(typeof buildWithUnknownReason).toBe('function');
  });
});
