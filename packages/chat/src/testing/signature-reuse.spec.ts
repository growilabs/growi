// Adversarial integration tests for the two ways a signature could be reused
// (design.md "#### 署名対象に**宛先の URL もパスも入れない**理由",
// "#### ⑤ で署名する値"; Requirement 9.6, 10.1, 10.7; design.md
// Testing Strategy / Integration Tests #6 and #7).
//
// These two are the pair of judgements the "no destination URL, no path in
// the signature" design rests on, and BOTH of them are invisible in the happy
// path: forget the purpose prefix in `pairingChallengePayload`, or drop
// `acceptEnvelope`'s `op` comparison, and every legitimate request still goes
// through exactly as before. Only an attack notices. So the properties are
// pinned here, at the layer that actually owns them.
//
// Two imports below deliberately reach modules that are NOT on the package's
// public surface (`signature/signature-base.js`, `signature/structured-fields.js`
// -- see `signature/index.ts`'s header for why they are held back, and
// `public-surface.spec.ts` for the drift test that keeps them there). An
// attacker builds the signature base and the two structured-field headers by
// hand; reproducing that faithfully is what these tests are for, so this is
// not a barrel export waiting to happen.

import { sign as nodeSign, verify as nodeVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  OP_ENDPOINTS,
  OP_NAMES,
  type OpName,
  parseAccountLinkStart,
  parseChallengeResponse,
  parseCommandRequest,
  parseKeyRegistration,
  parseKeyRevocation,
  parseNotificationRequest,
  parseOpEnvelope,
  parseOwnershipChallenge,
  parseSettingsPush,
  type RequestEnvelope,
} from '../index.js';
import {
  acceptEnvelope,
  COVERED_COMPONENTS,
  computeContentDigest,
  encodeKeyId,
  type KeyRef,
  pairingChallengePayload,
  SIGNATURE_ALGORITHM,
  SIGNATURE_LABEL,
  sign,
  verify,
} from '../server.js';
import {
  buildSignatureBase,
  type SignatureParamValue,
} from '../signature/signature-base.js';
import {
  serializeByteSequenceDictionary,
  serializeStringInnerList,
} from '../signature/structured-fields.js';
import {
  answerOwnershipChallenge,
  createGrowiSide,
  createOwnKey,
  createProxySide,
  type GrowiSide,
  holdPendingRegistration,
  type OwnKey,
  type ProxySide,
  publicKeyRegistrationOf,
  resolvePeerPublicKey,
  runPairing,
} from './pairing-harness.js';

const GROWI_URI = 'https://growi.example.com';
const CONTENT_TYPE = 'application/json';

/** A paired proxy/GROWI couple plus the `relationId` both sides now hold. */
interface PairedCouple {
  readonly proxy: ProxySide;
  readonly growi: GrowiSide;
  readonly relationId: string;
}

const pairOnce = (): PairedCouple => {
  const proxy = createProxySide();
  const growi = createGrowiSide({ growiUri: GROWI_URI });
  const run = runPairing(proxy, growi);

  if (run.result.status !== 'paired') {
    throw new Error(
      `test setup: pairing did not complete (${run.result.status})`,
    );
  }
  return { proxy, growi, relationId: run.result.relationId };
};

// ---------------------------------------------------------------------------
// A signed request, assembled the way an attacker would: every part chosen by
// hand, and the signature bytes supplied separately from the base they are
// supposed to cover. `sign` cannot be used for this -- it only ever produces a
// signature made with a private key it was handed, and the whole point here is
// to put SOMEONE ELSE'S signature bytes onto a base they do not match.
// ---------------------------------------------------------------------------

interface ForgedRequest {
  readonly signatureBase: string;
  readonly body: Uint8Array;
  /** Builds the headers to send, given the signature bytes to claim. */
  readonly headersWith: (signatureBytes: Uint8Array) => Record<string, string>;
}

const buildForgedRequest = (params: {
  readonly body: unknown;
  readonly key: KeyRef;
}): ForgedRequest => {
  const body = Buffer.from(JSON.stringify(params.body), 'utf8');
  const contentDigest = computeContentDigest(body);

  const nowSec = Math.floor(Date.now() / 1000);
  const signatureParams = new Map<string, SignatureParamValue>([
    ['created', nowSec],
    ['expires', nowSec + 60],
    ['nonce', 'Zm9yZ2VkLW5vbmNlLXYx'],
    ['keyid', encodeKeyId(params.key)],
    ['alg', SIGNATURE_ALGORITHM],
  ]);

  const signatureBase = buildSignatureBase(
    COVERED_COMPONENTS,
    {
      method: 'POST',
      headers: {
        'content-type': CONTENT_TYPE,
        'content-digest': contentDigest,
      },
    },
    signatureParams,
  );

  return {
    signatureBase,
    body,
    headersWith: (signatureBytes) => ({
      'content-type': CONTENT_TYPE,
      'content-digest': contentDigest,
      'signature-input': `${SIGNATURE_LABEL}=${serializeStringInnerList(
        [...COVERED_COMPONENTS],
        signatureParams,
      )}`,
      signature: serializeByteSequenceDictionary(
        new Map([[SIGNATURE_LABEL, signatureBytes]]),
      ),
    }),
  };
};

describe('署名の代行窓口 -- pairing step 5 cannot be used to sign a production request', () => {
  // design.md "#### ⑤ で署名する値" / Testing Strategy Integration Tests #6.
  //
  // The attack: whoever sees a registration code while the pairing window is
  // open can call GROWI's step-5 endpoint directly, as often as it likes, and
  // gets back a signature made with the SAME key that signs production
  // requests. If step 5 signed the received `challenge` verbatim, feeding it
  // an RFC 9421 signature base would hand back a usable `Signature` header.

  /**
   * The couple is paired FIRST, so GROWI's key is registered and a
   * `relationId` exists -- and only then is a second pending registration
   * held (a hub proxy serves many GROWI instances, Requirement 8.1, so a
   * GROWI pairing with a second proxy while an existing relation runs is an
   * ordinary situation). That is what makes the attack worth attempting: a
   * signature squeezed out of step 5 would be used against the relation that
   * is ALREADY live.
   */
  const setUpOraclePosition = () => {
    const couple = pairOnce();
    const registrationCode = 'second-pairing-registration-code';
    holdPendingRegistration(couple.growi, registrationCode);

    const growiKey: KeyRef = {
      relationId: couple.relationId,
      keyId: couple.growi.ownKey.keyId,
    };
    // The forged request the attacker wants a signature for: a `settings-push`
    // that would rewrite the proxy's channel permissions for this relation.
    const forged = buildForgedRequest({
      body: {
        relationId: couple.relationId,
        op: OP_NAMES.settingsPush,
        settings: {
          relationId: couple.relationId,
          channelPermissions: [
            { commandName: 'create-page', allowedChannels: 'all' },
          ],
        },
        version: 99,
      },
      key: growiKey,
    });

    return { ...couple, registrationCode, growiKey, forged };
  };

  /**
   * Verifies the forged request as the proxy would: the key resolved for the
   * relation is GROWI's registered PUBLIC key, exactly as it was stored at
   * pairing time.
   */
  const verifyAsProxy = (
    proxy: ProxySide,
    relationId: string,
    forged: ForgedRequest,
    signatureBytes: Uint8Array,
  ) => {
    const relation = proxy.relations.get(relationId);
    if (relation == null) {
      throw new Error('test setup: the proxy holds no such relation');
    }
    return verify({
      method: 'POST',
      headers: forged.headersWith(signatureBytes),
      body: forged.body,
      resolvePublicKey: async (ref) =>
        resolvePeerPublicKey(relation, ref, new Date()),
      consumeNonce: async () => true,
    });
  };

  it('refuses a raw RFC 9421 signature base as the `challenge` (400 -- it is not base64url)', () => {
    const { growi, registrationCode, forged } = setUpOraclePosition();

    // The wire-shape gate is what stops this one, before any signing is
    // reached: a signature base carries `"`, `:`, spaces and newlines, none
    // of which are base64url.
    expect(forged.signatureBase).toMatch(/["\n: ]/);
    expect(
      parseOwnershipChallenge({
        registrationCode,
        challenge: forged.signatureBase,
      }),
    ).toStrictEqual({ error: 'malformed' });

    // And the endpoint answers 400 -- so the request never reaches the
    // signing step at all. What this test fixes is "it is refused, with the
    // shape rejection", not the weaker "no usable signature came back".
    expect(
      answerOwnershipChallenge(growi, {
        registrationCode,
        challenge: forged.signatureBase,
      }),
    ).toStrictEqual({ status: 400 });
  });

  it('refuses a base64url-ENCODED signature base too -- no signature base fits the 32..128 window', () => {
    const { growi, registrationCode, forged } = setUpOraclePosition();

    const encoded = Buffer.from(forged.signatureBase, 'utf8').toString(
      'base64url',
    );
    // Encoding gets past the character-set half of the shape check; the
    // length half still refuses it. That is not luck: a signature base always
    // carries every covered component's line AND the whole
    // `@signature-params` line, so the shortest one this protocol can produce
    // is already past the 128-character window before it is even encoded, and
    // base64url only makes it a third longer again.
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(
      parseOwnershipChallenge({ registrationCode, challenge: encoded }),
    ).toStrictEqual({ error: 'malformed' });
    expect(
      answerOwnershipChallenge(growi, {
        registrationCode,
        challenge: encoded,
      }),
    ).toStrictEqual({ status: 400 });
  });

  it('produces a signature that is useless as a production signature, even with the wire-shape gate bypassed entirely', async () => {
    const { proxy, growi, relationId, registrationCode, forged } =
      setUpOraclePosition();

    // Step 5's signing, called DIRECTLY -- `parseOwnershipChallenge`'s
    // wire-shape gate is skipped on purpose. The two tests above show that
    // gate holding today; this one shows the purpose prefix ALONE would still
    // close the route if a future change relaxed the gate (a longer
    // `challenge`, say), so nobody has to know that the base64url check is
    // load-bearing for this property as well.
    const oracleAnswerOver = (payload: string): Uint8Array =>
      nodeSign(null, Buffer.from(payload, 'utf8'), growi.ownKey.privateKey);

    const answerWithPrefix = oracleAnswerOver(
      pairingChallengePayload(registrationCode, forged.signatureBase),
    );
    // Same key, same request, same headers -- the ONLY difference from the
    // control below is the string that was signed. So a rejection here can
    // only come from the prefix.
    const answerWithoutPrefix = oracleAnswerOver(forged.signatureBase);

    // What step 5 really answers does not verify against the signature base.
    expect(
      nodeVerify(
        null,
        Buffer.from(forged.signatureBase, 'utf8'),
        growi.ownKey.publicKey,
        answerWithPrefix,
      ),
    ).toBe(false);
    await expect(
      verifyAsProxy(proxy, relationId, forged, answerWithPrefix),
    ).resolves.toStrictEqual({ ok: false, failure: 'signature-mismatch' });

    // Control: a step 5 that signed the bare `challenge` WOULD hand the
    // attacker a working `Signature` header. Without this the test above
    // would keep passing after someone deleted the prefix -- a typo in the
    // hand-built headers reads as `signature-mismatch` just the same.
    await expect(
      verifyAsProxy(proxy, relationId, forged, answerWithoutPrefix),
    ).resolves.toStrictEqual({
      ok: true,
      key: { relationId, keyId: growi.ownKey.keyId },
    });
  });

  it('signs exactly `pairingChallengePayload(code, challenge)` -- the value the test above models', () => {
    // Ties the direct call above to the shipping endpoint: if
    // `answerOwnershipChallenge` ever composed a different payload, the model
    // used by the previous test would be checking something nothing sends.
    // Ed25519 is deterministic, so the two signatures compare byte for byte.
    const { growi, registrationCode } = setUpOraclePosition();
    const challenge = 'Y2hhbGxlbmdl'.repeat(4);

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

    const modelled = nodeSign(
      null,
      Buffer.from(pairingChallengePayload(registrationCode, challenge), 'utf8'),
      growi.ownKey.privateKey,
    ).toString('base64url');
    expect(response.challengeSignature).toBe(modelled);
  });
});

describe('別の口への流用 -- a signature made for one op is refused at every other op', () => {
  // design.md "#### 署名対象に**宛先の URL もパスも入れない**理由" /
  // Testing Strategy Integration Tests #7; Requirement 10.1, 10.7.
  //
  // Division of labour, which these tests assert at their proper layers:
  //   `verify`        -- answers ONLY the cryptographic question. The bytes
  //                      were not touched, so it says `ok: true`. It cannot
  //                      see which endpoint received them: the signature
  //                      covers neither the target URL nor the path.
  //   `acceptEnvelope` -- compares the body's `op` against the op of the
  //                      endpoint that physically got the bytes, which only
  //                      the receiving side knows. This is the single
  //                      constraint that replaced URL and path coverage.
  // Asserting the rejection on `verify` instead would be checking a property
  // that deliberately does not exist there.

  const REVOCABLE_KEY_ID = 'revoked-key-0001';

  const bodyFor = (op: OpName, relationId: string, spareKey: OwnKey) => {
    switch (op) {
      case OP_NAMES.command:
        return {
          relationId,
          op,
          requestId: 'req-0001',
          actor: {
            platform: 'slack',
            accountId: 'U0123456789',
            displayName: 'Alice',
          },
          channel: {
            platform: 'slack',
            channelId: 'C0123456789',
            channelName: 'general',
            isPrivate: false,
          },
          kind: 'help',
        };
      case OP_NAMES.accountLinkStart:
        return {
          relationId,
          op,
          actor: {
            platform: 'slack',
            accountId: 'U0123456789',
            displayName: 'Alice',
          },
        };
      case OP_NAMES.keyRegisterToGrowi:
      case OP_NAMES.keyRegisterToProxy:
        return { relationId, op, key: publicKeyRegistrationOf(spareKey) };
      case OP_NAMES.keyRevokeToGrowi:
      case OP_NAMES.keyRevokeToProxy:
        return { relationId, op, keyId: REVOCABLE_KEY_ID };
      case OP_NAMES.notification:
        return {
          relationId,
          op,
          requestId: 'req-0002',
          targets: [{ platform: 'slack', channelId: 'C0123456789' }],
          markdown: 'a page was updated',
          containsRestrictedPage: false,
        };
      case OP_NAMES.settingsPush:
        return {
          relationId,
          op,
          settings: { relationId, channelPermissions: [] },
          version: 1,
        };
      default:
        // capabilities / connection-status / channels / settings-pull: the
        // envelope itself is the whole body (`OpOnlyRequest`).
        return { relationId, op };
    }
  };

  /**
   * Each op's OWN wire-shape check. Running it is what keeps these tests
   * about the op mismatch and nothing else: a fixture that failed its own
   * parser would be rejected downstream for an unrelated reason and the test
   * would prove nothing.
   */
  const parseFor = (
    op: OpName,
  ): ((raw: unknown) => RequestEnvelope | { readonly error: string }) => {
    switch (op) {
      case OP_NAMES.command:
        return parseCommandRequest;
      case OP_NAMES.accountLinkStart:
        return parseAccountLinkStart;
      case OP_NAMES.keyRegisterToGrowi:
      case OP_NAMES.keyRegisterToProxy:
        return parseKeyRegistration;
      case OP_NAMES.keyRevokeToGrowi:
      case OP_NAMES.keyRevokeToProxy:
        return parseKeyRevocation;
      case OP_NAMES.notification:
        return parseNotificationRequest;
      case OP_NAMES.settingsPush:
        return parseSettingsPush;
      default:
        return parseOpEnvelope;
    }
  };

  /**
   * Signs a validly-shaped body for `op` with the key of whichever side
   * actually sends that op, and verifies it as the side that serves it.
   *
   * The direction is read from `OP_ENDPOINTS`, and the verifying side
   * resolves the key from ITS OWN relation record's `peerKeys` -- never
   * from one shared table. `verify`'s own contract requires the peer's key
   * and only the peer's key, and getting that wrong here would be resolving
   * the caller's own key, the exact mistake that doc comment warns about.
   */
  const signThenVerify = async (op: OpName, couple: PairedCouple) => {
    const { proxy, growi, relationId } = couple;
    const proxyRelation = proxy.relations.get(relationId);
    const growiRelation = growi.relations.get(relationId);
    if (proxyRelation == null || growiRelation == null) {
      throw new Error('test setup: both sides must hold the relation');
    }

    const sendingSideIsProxy = OP_ENDPOINTS[op].direction === 'proxy-to-growi';
    const senderKey = sendingSideIsProxy ? proxy.ownKey : growi.ownKey;
    const receiverRecord = sendingSideIsProxy ? growiRelation : proxyRelation;

    const raw = bodyFor(op, relationId, createOwnKey('spare-key-000001'));
    const parsed = parseFor(op)(raw);
    // The fixture is well-formed for its own op -- so the rejection below is
    // the op mismatch, not a shape problem this test never meant to exercise.
    expect(parsed).not.toHaveProperty('error');
    if ('error' in parsed) {
      throw new Error(`test setup: fixture for ${op} is malformed`);
    }

    const body = Buffer.from(JSON.stringify(raw), 'utf8');
    const key: KeyRef = { relationId, keyId: senderKey.keyId };
    const signed = sign({
      method: 'POST',
      headers: { 'content-type': CONTENT_TYPE },
      body,
      key,
      privateKey: senderKey.privateKey,
      expiresInSec: 60,
    });

    const verified = await verify({
      method: 'POST',
      headers: { 'content-type': CONTENT_TYPE, ...signed.headers },
      body,
      resolvePublicKey: async (ref) =>
        resolvePeerPublicKey(receiverRecord, ref, new Date()),
      // Replay is task 7.5's subject; a fresh stub per call keeps this file
      // from looking as though it asserted anything about nonce state.
      consumeNonce: async () => true,
    });

    return { raw, parsed, verified, key };
  };

  const OP_LIST: ReadonlyArray<OpName> = Object.values(OP_NAMES);

  it('covers every op in OP_NAMES', () => {
    // Guards the `it.each` below against silently shrinking if an op is
    // added and the table stops being exhaustive.
    expect(OP_LIST).toHaveLength(12);
  });

  it.each(
    OP_LIST.map((op, index) => ({
      op,
      // A different op for every case, cycled rather than fixed, so the
      // spread covers both directions and both sides of every parse function.
      otherOp: OP_LIST[(index + 1) % OP_LIST.length] as OpName,
    })),
  )('a $op signature replayed at the $otherOp endpoint is refused', async ({
    op,
    otherOp,
  }) => {
    const couple = pairOnce();
    const { parsed, verified, key } = await signThenVerify(op, couple);

    // The bytes were not tampered with, so the CRYPTOGRAPHIC answer is yes.
    // This assertion is the point of the test, not a step towards it: if
    // `verify` ever started answering the endpoint question too, the two
    // checks would be in two places and one of them would rot.
    expect(verified).toStrictEqual({ ok: true, key });
    if (!verified.ok) {
      return;
    }

    // Same body, same verified key -- only the endpoint differs.
    expect(acceptEnvelope(parsed, verified.key, otherOp)).toStrictEqual({
      ok: false,
      failure: 'malformed',
    });
    // ... and at its own endpoint it is accepted, so the rejection above is
    // the op comparison and not a body this side would never take at all.
    expect(acceptEnvelope(parsed, verified.key, op)).toStrictEqual({
      ok: true,
      body: parsed,
    });
  });

  it.each([
    {
      sentOp: OP_NAMES.keyRegisterToGrowi,
      replayedAtOp: OP_NAMES.keyRegisterToProxy,
      receivingParse: parseKeyRegistration,
    },
    {
      sentOp: OP_NAMES.keyRevokeToGrowi,
      replayedAtOp: OP_NAMES.keyRevokeToProxy,
      receivingParse: parseKeyRevocation,
    },
  ])('refuses $sentOp replayed at $replayedAtOp -- the pairs where acceptEnvelope is the ONLY gate', async ({
    sentOp,
    replayedAtOp,
    receivingParse,
  }) => {
    // These two ops flow in BOTH directions, so the parse function each
    // endpoint runs has a two-member allow-list and cannot tell the two
    // apart. The `it.each` above never lands on either pair, because its
    // cycle steps to the next op rather than to the same op in the opposite
    // direction -- so this is where "same operation, other side" is covered.
    const couple = pairOnce();
    const { raw, parsed, verified } = await signThenVerify(sentOp, couple);

    expect(verified.ok).toBe(true);
    if (!verified.ok) {
      return;
    }

    // What the RECEIVING endpoint runs on the bytes it got: the proxy's own
    // key-register / key-revoke endpoint parses the body aimed at GROWI and
    // finds nothing wrong with it. Run on `raw` -- the value that arrived --
    // not on the already-parsed body, so this really is the receiving side's
    // own check and not a repeat of the sending side's.
    expect(receivingParse(raw)).not.toHaveProperty('error');

    // So nothing but this stands between a key operation aimed at GROWI and
    // the proxy's own key table.
    expect(acceptEnvelope(parsed, verified.key, replayedAtOp)).toStrictEqual({
      ok: false,
      failure: 'malformed',
    });
  });
});
