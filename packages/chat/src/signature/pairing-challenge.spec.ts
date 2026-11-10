import { describe, expect, it } from 'vitest';

import { COVERED_COMPONENTS } from './covered-components.js';
import { pairingChallengePayload } from './pairing-challenge.js';
import {
  buildSignatureBase,
  type SignatureBaseMessage,
  type SignatureParamValue,
} from './signature-base.js';

const PURPOSE_PREFIX = 'growi-chat-pairing-challenge:v1:';

const message: SignatureBaseMessage = {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'content-digest':
      'sha-512=:WZDPaVn/7XgHaAy8pmojAkGWoRx2UFChF41A2svX+TaPm+AbwAgBWnrIiYllu7BNNyealdVLvRwEmTHWXvJwew==:',
  },
};

const signatureParams = (): ReadonlyMap<string, SignatureParamValue> =>
  new Map<string, SignatureParamValue>([
    ['created', 1_700_000_000],
    ['expires', 1_700_000_060],
    ['nonce', 'bm9uY2UtdmFsdWU'],
    ['keyid', 'relation-abcdef12:key-abcdef12'],
    ['alg', 'ed25519'],
  ]);

const realSignatureBase = (): string =>
  buildSignatureBase([...COVERED_COMPONENTS], message, signatureParams());

describe('pairingChallengePayload', () => {
  it('concatenates the versioned purpose prefix, the registration code and the challenge', () => {
    expect(pairingChallengePayload('reg-code-1', 'Y2hhbGxlbmdl')).toBe(
      'growi-chat-pairing-challenge:v1:reg-code-1:Y2hhbGxlbmdl',
    );
  });

  it('is deterministic for the same inputs', () => {
    const first = pairingChallengePayload('reg-code-1', 'Y2hhbGxlbmdl');
    const second = pairingChallengePayload('reg-code-1', 'Y2hhbGxlbmdl');
    expect(first).toBe(second);
  });

  it('builds the value only out of the registration code and the challenge (Requirement 9.2)', () => {
    // Both sides hold these two values as identical strings: the proxy issues
    // `registrationCode` and gets it back at step 4, and it generates
    // `challenge` itself. Nothing that either side derives from its own
    // configuration -- above all the peer's URL -- may appear, or a single
    // character of disagreement (trailing slash, letter case, an explicit
    // ":443") would make pairing impossible for an ordinary deployment.
    const payload = pairingChallengePayload('reg-code-1', 'Y2hhbGxlbmdl');

    expect(payload).toBe(`${PURPOSE_PREFIX}${'reg-code-1'}:${'Y2hhbGxlbmdl'}`);
    for (const uriLike of [
      'https://proxy.example.com',
      'proxy.example.com',
      'https://growi.example.com',
      'growi.example.com',
    ]) {
      expect(payload).not.toContain(uriLike);
    }
  });

  it('distinguishes different registration codes and different challenges', () => {
    const base = pairingChallengePayload('reg-code-1', 'Y2hhbGxlbmdl');
    expect(pairingChallengePayload('reg-code-2', 'Y2hhbGxlbmdl')).not.toBe(
      base,
    );
    expect(pairingChallengePayload('reg-code-1', 'Y2hhbGxlbmdlMg')).not.toBe(
      base,
    );
  });

  // ---------------------------------------------------------------------
  // The signing-oracle the purpose prefix closes (Requirement 9.2, 9.6, 10.1)
  //
  // Pairing step 5 is an unsigned endpoint that answers with a signature made
  // by the SAME private key that later signs production requests. If it signed
  // the received `challenge` verbatim, anyone who saw the registration code
  // could send the signature base of a forged production request as the
  // `challenge` and get back a signature that passes on the real endpoint.
  // ---------------------------------------------------------------------
  describe('can never collide with an RFC 9421 signature base', () => {
    it('never begins with a quoted component identifier, which every signature base does', () => {
      const base = realSignatureBase();
      expect(base.startsWith('"')).toBe(true);
      expect(base).toContain('\n');

      // Even a challenge carrying newlines cannot make the payload look like a
      // signature base: it is the first line that decides, and the first line
      // always starts with the purpose prefix, never with `"`.
      for (const challenge of [
        'Y2hhbGxlbmdl',
        base,
        `"@method": POST`,
        'x\n"@method": POST',
        '',
      ]) {
        const payload = pairingChallengePayload('reg-code-1', challenge);
        expect(payload.startsWith(PURPOSE_PREFIX)).toBe(true);
        expect(payload.startsWith('"')).toBe(false);
        expect(payload.split('\n')[0]?.startsWith('"')).toBe(false);
      }
    });

    it('does not return the signature base itself when the attacker submits one as the challenge', () => {
      const base = realSignatureBase();
      const payload = pairingChallengePayload('reg-code-1', base);

      expect(payload).not.toBe(base);
      // Whatever gets signed carries the prefix, so the resulting signature is
      // not a signature over `base` and cannot be replayed as one.
      expect(payload).toBe(`${PURPOSE_PREFIX}reg-code-1:${base}`);
    });

    it('cannot be made equal to a signature base by any registration code or challenge', () => {
      const bases = [
        realSignatureBase(),
        buildSignatureBase(
          ['@method', 'content-type'],
          message,
          signatureParams(),
        ),
        buildSignatureBase(
          ['@method', '@authority', '@path'],
          {
            method: 'POST',
            headers: {},
            derivedComponents: {
              '@authority': 'growi.example.com',
              '@path': '/_api/v3/chat-integration/peer/command',
            },
          },
          signatureParams(),
        ),
      ];

      const registrationCodes = ['', 'reg-code-1', '"', '"@method'];
      const challenges = ['', 'Y2hhbGxlbmdl', ...bases];

      for (const base of bases) {
        for (const registrationCode of registrationCodes) {
          for (const challenge of challenges) {
            expect(
              pairingChallengePayload(registrationCode, challenge),
            ).not.toBe(base);
          }
        }
      }
    });
  });

  it('documents the separator ambiguity that only the proxy-side code issuing registration codes can close', () => {
    // `PairingSubmission.registrationCode` (task 3.3) carries no shape
    // constraint, unlike `keyId` (task 2.4's `isValidKeyIdShape`), so two
    // different splits of the same characters produce the same payload.
    // This is NOT closed here: the design keeps this function to a plain
    // concatenation, and the split cannot be steered in practice because the
    // proxy issues `registrationCode` itself, keeps the pending row, and
    // matches against its own issued value, while `challenge` is
    // proxy-generated base64url.
    expect(pairingChallengePayload('A', 'B:C')).toBe(
      pairingChallengePayload('A:B', 'C'),
    );
    // Separator-free inputs -- what the proxy actually issues, since it
    // generates both fields -- always land on distinct payloads: the split
    // position is fixed by the first `:` after the prefix.
    expect(pairingChallengePayload('AB', 'C')).not.toBe(
      pairingChallengePayload('A', 'BC'),
    );
  });
});
