// Integration test for the pairing procedure's six steps (design.md
// "ペアリング — 申告された URL の扱い", 手順（①〜⑥）; Requirement 9.1, 9.5;
// design.md Testing Strategy / Integration Tests #1).
//
// Both roles are played by `pairing-harness.ts`, which is built out of
// `@growi/chat`'s own public entry points only. The point of the test is that
// the six steps compose end to end and that BOTH sides come out holding the
// other side's public key under one shared `relationId`.

import { verify as nodeVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { parseChallengeResponse, parsePairingSubmission } from '../index.js';
import { pairingChallengePayload } from '../server.js';
import {
  answerOwnershipChallenge,
  buildPairingSubmission,
  completePairing,
  createChallengeDelivery,
  createGrowiSide,
  createProxySide,
  holdPendingRegistration,
  issueRegistrationCode,
  receivePairingResult,
  receivePairingSubmission,
  runPairing,
  toPublicKeyObject,
} from './pairing-harness.js';

const GROWI_URI = 'https://growi.example.com';

describe('pairing procedure (steps 1-6)', () => {
  it('completes the six steps and leaves both sides holding the other public key', () => {
    const proxy = createProxySide();
    const growi = createGrowiSide({ growiUri: GROWI_URI });

    // (1) proxy issues a registration code -- proxy-internal state, no wire type.
    const registrationCode = issueRegistrationCode(proxy);
    expect(proxy.pending.has(registrationCode)).toBe(true);

    // (2) the admin pastes it into GROWI, which holds it as a pending registration.
    holdPendingRegistration(growi, registrationCode);
    expect(growi.pendingRegistration?.registrationCode).toBe(registrationCode);

    // (3) GROWI submits its own public key with the code.
    const submission = buildPairingSubmission(growi);
    expect(parsePairingSubmission(submission)).toStrictEqual(submission);
    expect(submission.publicKey.publicKeyJwk).not.toHaveProperty('d');

    const receipt = receivePairingSubmission(proxy, submission);
    expect(receipt).toStrictEqual({ accepted: true, submission });

    // (4) + (6) proxy challenges the DECLARED uri and, on a valid answer,
    // registers both keys. (5) happens inside the delivery function below.
    const result = completePairing(proxy, {
      registrationCode,
      deliverChallenge: createChallengeDelivery([growi]),
    });

    expect(result.status).toBe('paired');
    if (result.status !== 'paired') {
      return;
    }

    // GROWI stores proxy's key from the result it gets back.
    expect(receivePairingResult(growi, result)).toStrictEqual({
      accepted: true,
      relationId: result.relationId,
    });

    // Both sides now hold ONE relation, under the SAME relationId, each
    // carrying the OTHER side's public key.
    const proxyRelation = proxy.relations.get(result.relationId);
    const growiRelation = growi.relations.get(result.relationId);
    expect(proxyRelation).toBeDefined();
    expect(growiRelation).toBeDefined();

    expect(proxyRelation?.peerKeys).toStrictEqual([
      { ...submission.publicKey, revokedAt: null },
    ]);
    expect(proxyRelation?.ownKey.keyId).toBe(proxy.ownKey.keyId);
    expect(proxyRelation?.peerUri).toBe(GROWI_URI);

    expect(growiRelation?.peerKeys).toStrictEqual([
      { ...result.publicKey, revokedAt: null },
    ]);
    expect(growiRelation?.ownKey.keyId).toBe(growi.ownKey.keyId);

    // The two sides really exchanged keys -- neither stored its own key as
    // the peer's.
    expect(proxyRelation?.peerKeys[0]?.keyId).toBe(growi.ownKey.keyId);
    expect(growiRelation?.peerKeys[0]?.keyId).toBe(proxy.ownKey.keyId);

    // The registration code was consumed by the successful pairing.
    expect(proxy.pending.has(registrationCode)).toBe(false);
  });

  it('signs the purpose-prefixed payload at step 5, not the bare challenge', () => {
    const growi = createGrowiSide({ growiUri: GROWI_URI });
    const registrationCode = 'registration-code-for-signing-test';
    holdPendingRegistration(growi, registrationCode);

    const challenge = 'Y2hhbGxlbmdl'.repeat(3); // 36 chars, base64url.
    const answer = answerOwnershipChallenge(growi, {
      registrationCode,
      challenge,
    });

    expect(answer.status).toBe(200);
    if (answer.status !== 200) {
      return;
    }

    const response = parseChallengeResponse(answer.body);
    expect(response).not.toHaveProperty('error');
    if ('error' in response) {
      return;
    }
    expect(response.challenge).toBe(challenge);

    const growiPublicKey = toPublicKeyObject(
      buildPairingSubmission(growi).publicKey,
    );
    const signature = Buffer.from(response.challengeSignature, 'base64url');

    const payload = pairingChallengePayload(registrationCode, challenge);
    expect(payload.startsWith('growi-chat-pairing-challenge:v1:')).toBe(true);
    expect(
      nodeVerify(null, Buffer.from(payload, 'utf8'), growiPublicKey, signature),
    ).toBe(true);

    // The bare challenge is NOT what was signed -- that is the whole point of
    // the purpose prefix (design.md "⑤ で署名する値").
    expect(
      nodeVerify(
        null,
        Buffer.from(challenge, 'utf8'),
        growiPublicKey,
        signature,
      ),
    ).toBe(false);
  });

  // Keeps the step-6 signature check honest: without it, this pairing would
  // complete even though the party that answered holds a different key from
  // the one submitted at step 3 (Requirement 9.5).
  it('refuses to pair when the answer is signed by a key other than the submitted one', () => {
    const proxy = createProxySide();
    const growi = createGrowiSide({ growiUri: GROWI_URI });
    // Same URI, same pending code, its own key pair.
    const impostor = createGrowiSide({ growiUri: GROWI_URI });

    const registrationCode = issueRegistrationCode(proxy);
    holdPendingRegistration(growi, registrationCode);
    holdPendingRegistration(impostor, registrationCode);

    receivePairingSubmission(proxy, buildPairingSubmission(growi));

    const result = completePairing(proxy, {
      registrationCode,
      deliverChallenge: createChallengeDelivery([impostor]),
    });

    expect(result.status).toBe('ownership-unverified');
    expect(proxy.relations.size).toBe(0);
  });

  it('runPairing composes the same six steps', () => {
    const proxy = createProxySide();
    const growi = createGrowiSide({ growiUri: GROWI_URI });

    const { registrationCode, submission, result } = runPairing(proxy, growi);

    expect(registrationCode).toEqual(expect.any(String));
    expect(result.status).toBe('paired');
    if (result.status !== 'paired') {
      return;
    }
    expect(proxy.relations.get(result.relationId)?.peerKeys).toStrictEqual([
      { ...submission.publicKey, revokedAt: null },
    ]);
    expect(growi.relations.get(result.relationId)?.peerKeys).toStrictEqual([
      { ...result.publicKey, revokedAt: null },
    ]);
  });
});
