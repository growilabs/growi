// Adversarial integration tests for the pairing procedure: the routes that
// MUST NOT complete a pairing (design.md "ペアリング — 申告された URL の扱い",
// "#### ⑤ に条件が要る理由", "#### ⑤ が公開鍵を縛る理由", and the `鍵の識別子`
// decision table's first row; Requirement 9.2, 9.3, 9.4, 10.6; design.md
// Testing Strategy / Integration Tests #2, #3, #5, #8).
//
// `pairing-flow.spec.ts` (task 7.2) fixes the happy path. This file fixes the
// failure paths, and each test asserts the SPECIFIC contract variant that is
// supposed to come back -- not merely "it did not succeed". A test that only
// checked `status !== 'paired'` would still pass if the procedure started
// answering `code-expired` to a key-substitution attempt, which would hide a
// real defect behind a plausible-looking rejection.
//
// Both roles are played by `pairing-harness.ts`, unmodified: its `TimeOptions`
// seam (`now` / `ttlSec`) already lets a caller place every step on a chosen
// clock, and its per-step exports already let a caller hand-craft a body at
// any point in the procedure.

import { describe, expect, it } from 'vitest';

import { type PairingSubmission, parsePairingResult } from '../index.js';
import {
  answerOwnershipChallenge,
  buildPairingSubmission,
  type ChallengeAnswer,
  completePairing,
  createChallengeDelivery,
  createGrowiSide,
  createProxySide,
  type DeliverChallenge,
  holdPendingRegistration,
  issueRegistrationCode,
  publicKeyRegistrationOf,
  receivePairingResult,
  receivePairingSubmission,
} from './pairing-harness.js';

const GROWI_URI = 'https://growi.example.com';
const OTHER_GROWI_URI = 'https://other-growi.example.com';
const ATTACKER_URI = 'https://attacker.example.com';

/** base64url, 48 chars -- inside `OwnershipChallenge`'s 32..128 range. */
const CHALLENGE = 'Y2hhbGxlbmdl'.repeat(4);

const T0 = new Date('2026-01-01T00:00:00.000Z');
const TTL_SEC = 600;
const BEFORE_EXPIRY = new Date(T0.getTime() + (TTL_SEC - 1) * 1000);
const AFTER_EXPIRY = new Date(T0.getTime() + (TTL_SEC + 1) * 1000);

describe('a party that never started pairing does not answer step 5', () => {
  // design.md "⑤ に条件が要る理由" / Testing Strategy Integration Tests #2.
  // Without this condition, ④ would only prove "some Gen 2 GROWI lives at that
  // URI", which is not Requirement 9.2's "その URL の持ち主だけが答えられる確認".
  it('answers 401 when it holds no pending registration at all', () => {
    const bystander = createGrowiSide({ growiUri: OTHER_GROWI_URI });
    expect(bystander.pendingRegistration).toBeNull();

    const answer = answerOwnershipChallenge(bystander, {
      registrationCode: 'code-this-side-never-received',
      challenge: CHALLENGE,
    });

    // 401 (no matching pending registration), NOT 410 (which would mean it
    // once held this code and the hold ran out) and NOT 400 (malformed body).
    expect(answer).toStrictEqual({ status: 401 });
  });

  it('answers 401 while it is pairing with a DIFFERENT registration code', () => {
    const bystander = createGrowiSide({ growiUri: OTHER_GROWI_URI });
    holdPendingRegistration(bystander, 'the-code-this-side-is-pairing-with', {
      now: T0,
      ttlSec: TTL_SEC,
    });

    const answer = answerOwnershipChallenge(
      bystander,
      { registrationCode: 'some-other-proxys-code', challenge: CHALLENGE },
      { now: T0 },
    );

    expect(answer).toStrictEqual({ status: 401 });
  });

  // Requirement 9.3: the pairing is not completed AND the failure is reported
  // as a distinguishable reason (the exact `detail` asserted below) rather than
  // as a generic error.
  it('does not complete a pairing that declares the URI of an uninvolved GROWI', () => {
    const proxy = createProxySide();
    const bystander = createGrowiSide({ growiUri: OTHER_GROWI_URI });
    // The attacker knows the code (it saw it) and has its own key pair.
    const attacker = createGrowiSide({ growiUri: ATTACKER_URI });

    const registrationCode = issueRegistrationCode(proxy, {
      now: T0,
      ttlSec: TTL_SEC,
    });

    // Step 3 is unsigned, so the attacker can hand-craft it: it names the
    // bystander's URI and its own public key.
    const submission: PairingSubmission = {
      registrationCode,
      growiUri: bystander.growiUri,
      growiLabel: 'Not Actually Mine',
      publicKey: publicKeyRegistrationOf(attacker.ownKey),
    };
    expect(
      receivePairingSubmission(proxy, submission, { now: T0 }),
    ).toStrictEqual({ accepted: true, submission });

    const answers: ChallengeAnswer[] = [];
    const deliverChallenge: DeliverChallenge = (growiUri, body) => {
      const answer = createChallengeDelivery([bystander], { now: T0 })(
        growiUri,
        body,
      );
      answers.push(answer);
      return answer;
    };

    const result = completePairing(proxy, {
      registrationCode,
      deliverChallenge,
      now: T0,
    });

    // The challenge really did reach the bystander, and the bystander refused
    // to answer it -- that refusal is what stopped the pairing.
    expect(answers).toStrictEqual([{ status: 401 }]);
    expect(result).toStrictEqual({
      status: 'ownership-unverified',
      detail: 'ownership confirmation answered 401',
    });
    expect(proxy.relations.size).toBe(0);
    expect(bystander.relations.size).toBe(0);
  });
});

describe('an expired registration code is refused with the contract variant for expiry', () => {
  // Requirement 9.4 / Testing Strategy Integration Tests #3.
  //
  // `completePairing` folds "no such pending registration" and "the pending
  // registration ran out" into the same `code-expired` (tasks.md Implementation
  // Note 7.2 (a)), so a real code IS issued and held here, and only the clock
  // moves. The `at BEFORE_EXPIRY` control below is what proves this test
  // discriminates on the expiry itself rather than on "no code was ever issued".
  const setUpPendingPairing = () => {
    const proxy = createProxySide();
    const growi = createGrowiSide({ growiUri: GROWI_URI });

    const registrationCode = issueRegistrationCode(proxy, {
      now: T0,
      ttlSec: TTL_SEC,
    });
    holdPendingRegistration(growi, registrationCode, {
      now: T0,
      ttlSec: TTL_SEC,
    });

    return { proxy, growi, registrationCode };
  };

  it('completes while the code is still live (control for the expiry tests)', () => {
    const { proxy, growi, registrationCode } = setUpPendingPairing();
    receivePairingSubmission(proxy, buildPairingSubmission(growi), { now: T0 });

    const result = completePairing(proxy, {
      registrationCode,
      deliverChallenge: createChallengeDelivery([growi], {
        now: BEFORE_EXPIRY,
      }),
      now: BEFORE_EXPIRY,
    });

    expect(result.status).toBe('paired');
  });

  it('returns code-expired from step 6 once the hold has run out', () => {
    const { proxy, growi, registrationCode } = setUpPendingPairing();
    receivePairingSubmission(proxy, buildPairingSubmission(growi), { now: T0 });

    let challengeWasDelivered = false;
    const deliverChallenge: DeliverChallenge = (growiUri, body) => {
      challengeWasDelivered = true;
      return createChallengeDelivery([growi], { now: AFTER_EXPIRY })(
        growiUri,
        body,
      );
    };

    const result = completePairing(proxy, {
      registrationCode,
      deliverChallenge,
      now: AFTER_EXPIRY,
    });

    expect(result).toStrictEqual({ status: 'code-expired' });
    // Not `ownership-unverified`: the code is judged before anything is sent
    // to the declared URI.
    expect(challengeWasDelivered).toBe(false);
    expect(proxy.relations.size).toBe(0);
    // The expired hold is dropped rather than left to be retried.
    expect(proxy.pending.has(registrationCode)).toBe(false);
  });

  it('refuses an expired code already at step 3', () => {
    const { proxy, growi, registrationCode } = setUpPendingPairing();

    expect(
      receivePairingSubmission(proxy, buildPairingSubmission(growi), {
        now: AFTER_EXPIRY,
      }),
    ).toStrictEqual({ accepted: false, reason: 'code-expired' });
    // Distinguished from a code this proxy never issued.
    expect(
      receivePairingSubmission(
        proxy,
        { ...buildPairingSubmission(growi), registrationCode: 'never-issued' },
        { now: T0 },
      ),
    ).toStrictEqual({ accepted: false, reason: 'unknown-code' });

    expect(proxy.pending.get(registrationCode)?.submission ?? null).toBeNull();
  });

  it('answers 410, not 401, once GROWI own hold has run out', () => {
    const { growi, registrationCode } = setUpPendingPairing();

    expect(
      answerOwnershipChallenge(
        growi,
        { registrationCode, challenge: CHALLENGE },
        { now: BEFORE_EXPIRY },
      ).status,
    ).toBe(200);

    expect(
      answerOwnershipChallenge(
        growi,
        { registrationCode, challenge: CHALLENGE },
        { now: AFTER_EXPIRY },
      ),
    ).toStrictEqual({ status: 410 });
  });
});

describe('a third party that knows the code cannot substitute its own key', () => {
  // design.md "#### ⑤ が公開鍵を縛る理由" -- the exact attack `challengeSignature`
  // exists to close (Testing Strategy Integration Tests #5; Requirement 9.2,
  // 9.5). Requirement 9.3 is the other half of it: the attempt does not
  // complete, and the reason it did not is reported (the exact `detail`
  // asserted below).
  //
  // The attacker declares the REAL GROWI's URI but submits its OWN public key.
  // Step 5's condition alone cannot stop this: the real GROWI holds that same
  // registration code, so it DOES answer. What stops it is that the real GROWI
  // signs with its own private key, which does not verify against the key the
  // attacker submitted.
  //
  // This is the mirror image of `pairing-flow.spec.ts`'s
  // "refuses to pair when the answer is signed by a key other than the
  // submitted one": there the honest key was submitted and an impostor
  // answered; here the honest party answers and an impostor's key was
  // submitted.
  it('does not pair when the submitted key is the attacker own and the real GROWI answers', () => {
    const proxy = createProxySide();
    const realGrowi = createGrowiSide({ growiUri: GROWI_URI });
    const attacker = createGrowiSide({ growiUri: ATTACKER_URI });

    const registrationCode = issueRegistrationCode(proxy, {
      now: T0,
      ttlSec: TTL_SEC,
    });
    // The admin pasted the code into the real GROWI; the attacker merely saw it.
    holdPendingRegistration(realGrowi, registrationCode, {
      now: T0,
      ttlSec: TTL_SEC,
    });

    const forgedSubmission: PairingSubmission = {
      registrationCode,
      growiUri: realGrowi.growiUri,
      growiLabel: realGrowi.growiLabel,
      publicKey: publicKeyRegistrationOf(attacker.ownKey),
    };
    // The two keys really are different -- otherwise this test would prove
    // nothing.
    expect(forgedSubmission.publicKey.publicKeyJwk).not.toStrictEqual(
      publicKeyRegistrationOf(realGrowi.ownKey).publicKeyJwk,
    );

    expect(
      receivePairingSubmission(proxy, forgedSubmission, { now: T0 }),
    ).toStrictEqual({ accepted: true, submission: forgedSubmission });

    const answers: ChallengeAnswer[] = [];
    const deliverChallenge: DeliverChallenge = (growiUri, body) => {
      const answer = createChallengeDelivery([realGrowi], { now: T0 })(
        growiUri,
        body,
      );
      answers.push(answer);
      return answer;
    };

    const result = completePairing(proxy, {
      registrationCode,
      deliverChallenge,
      challenge: CHALLENGE,
      now: T0,
    });

    // The challenge went to the REAL GROWI (the URI the attacker declared),
    // and the real GROWI DID answer 200 -- so step 5's "only while the code
    // matches" condition was satisfied and is NOT what stopped this. Without
    // this assertion the test could pass for the wrong reason.
    expect(answers).toHaveLength(1);
    expect(answers[0]?.status).toBe(200);

    // The signature check is what refuses it, and it is reported as
    // `ownership-unverified` -- not `code-expired`, not `already-paired`.
    expect(result).toStrictEqual({
      status: 'ownership-unverified',
      detail: 'challenge signature did not verify',
    });

    // Nothing was registered on either side: the attacker's key did not become
    // a relation, and neither did the real GROWI's.
    expect(proxy.relations.size).toBe(0);
    expect(realGrowi.relations.size).toBe(0);
    expect(receivePairingResult(realGrowi, result)).toStrictEqual({
      accepted: false,
      reason: 'not-paired',
    });
  });
});

describe('a result naming a relationId GROWI already holds does not pair', () => {
  // design.md `鍵の識別子` decision table, first row: "既にある `relationId` を返す
  // `PairingResult` はペアリングを成立させず、管理者に知らせる" (Requirement 10.6;
  // Testing Strategy Integration Tests #8).
  //
  // `relationId` is chosen by the far side, so a second proxy -- buggy,
  // compromised, or replaying an old result -- can name one this GROWI already
  // uses. Accepting it would replace an existing relation's peer key, letting
  // the second proxy pass as the first.
  it('refuses a second proxy result that reuses an existing relationId', () => {
    const growi = createGrowiSide({ growiUri: GROWI_URI });

    const proxyA = createProxySide({
      workspace: {
        platform: 'slack',
        workspaceId: 'T1111111111',
        workspaceName: 'first-workspace',
      },
    });
    const codeA = issueRegistrationCode(proxyA, { now: T0, ttlSec: TTL_SEC });
    holdPendingRegistration(growi, codeA, { now: T0, ttlSec: TTL_SEC });
    receivePairingSubmission(proxyA, buildPairingSubmission(growi), {
      now: T0,
    });
    const resultA = completePairing(proxyA, {
      registrationCode: codeA,
      deliverChallenge: createChallengeDelivery([growi], { now: T0 }),
      now: T0,
    });
    expect(resultA.status).toBe('paired');
    if (resultA.status !== 'paired') {
      return;
    }
    expect(receivePairingResult(growi, resultA)).toStrictEqual({
      accepted: true,
      relationId: resultA.relationId,
    });

    // A second proxy runs its own, genuinely completed pairing with the same
    // GROWI...
    const proxyB = createProxySide({
      workspace: {
        platform: 'slack',
        workspaceId: 'T2222222222',
        workspaceName: 'second-workspace',
      },
    });
    const codeB = issueRegistrationCode(proxyB, { now: T0, ttlSec: TTL_SEC });
    holdPendingRegistration(growi, codeB, { now: T0, ttlSec: TTL_SEC });
    receivePairingSubmission(proxyB, buildPairingSubmission(growi), {
      now: T0,
    });
    const resultB = completePairing(proxyB, {
      registrationCode: codeB,
      deliverChallenge: createChallengeDelivery([growi], { now: T0 }),
      now: T0,
    });
    expect(resultB.status).toBe('paired');
    if (resultB.status !== 'paired') {
      return;
    }

    // ...but names the relationId GROWI already uses for proxy A.
    const collidingResult = { ...resultB, relationId: resultA.relationId };
    // Still a well-formed `PairingResult`: the rejection below is about the
    // duplicate identifier, not about the shape.
    expect(parsePairingResult(collidingResult)).toStrictEqual(collidingResult);
    expect(collidingResult.publicKey.keyId).not.toBe(resultA.publicKey.keyId);

    expect(receivePairingResult(growi, collidingResult)).toStrictEqual({
      accepted: false,
      reason: 'relation-already-known',
    });

    // Proxy A's relation is untouched -- not overwritten, not duplicated.
    expect(growi.relations.size).toBe(1);
    expect(
      growi.relations.get(resultA.relationId)?.peerPublicKey,
    ).toStrictEqual(resultA.publicKey);
    // The pairing with proxy B is left unfinished rather than half-applied:
    // GROWI still holds proxy B's pending registration.
    expect(growi.pendingRegistration?.registrationCode).toBe(codeB);
  });
});
