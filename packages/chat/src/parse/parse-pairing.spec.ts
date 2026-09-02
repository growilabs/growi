import { describe, expect, it } from 'vitest';

import {
  parseChallengeResponse,
  parseOwnershipChallenge,
  parsePairingSubmission,
} from './parse-pairing.js';

const validJwk = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: 'base64url-public-component',
};

const validPublicKey = {
  keyId: 'abcdefgh12345678',
  publicKeyJwk: validJwk,
  validFrom: '2026-01-01T00:00:00.000Z',
};

const validSubmission = {
  registrationCode: 'a'.repeat(40),
  growiUri: 'https://growi.example.com',
  growiLabel: 'My GROWI',
  publicKey: validPublicKey,
};

// Exactly 32 chars, base64url-safe.
const challenge32 = 'A'.repeat(32);
// Exactly 128 chars, base64url-safe.
const challenge128 = 'A'.repeat(128);

const validChallenge = {
  registrationCode: 'a'.repeat(40),
  challenge: challenge32,
};

describe('parsePairingSubmission', () => {
  describe('non-object input', () => {
    it.each([null, [], 'a string', 42, undefined])('rejects %p', (value) => {
      expect(parsePairingSubmission(value)).toEqual({ error: 'malformed' });
    });
  });

  it('accepts a valid submission with all fields intact', () => {
    const result = parsePairingSubmission(validSubmission);
    expect(result).toEqual(validSubmission);
  });

  it.each([
    'registrationCode',
    'growiUri',
    'growiLabel',
    'publicKey',
  ] as const)('rejects when %s is missing', (field) => {
    const { [field]: _omitted, ...rest } = validSubmission;
    expect(parsePairingSubmission(rest)).toEqual({ error: 'malformed' });
  });

  it.each([
    'keyId',
    'publicKeyJwk',
    'validFrom',
  ] as const)('rejects when publicKey.%s is missing', (field) => {
    const { [field]: _omitted, ...restKey } = validPublicKey;
    expect(
      parsePairingSubmission({ ...validSubmission, publicKey: restKey }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects a publicKey.keyId failing isValidKeyIdShape (real function call)', () => {
    expect(
      parsePairingSubmission({
        ...validSubmission,
        publicKey: { ...validPublicKey, keyId: 'short' },
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects a publicKey.publicKeyJwk failing isValidPublicKeyMaterial (wrong kty)', () => {
    expect(
      parsePairingSubmission({
        ...validSubmission,
        publicKey: {
          ...validPublicKey,
          publicKeyJwk: { ...validJwk, kty: 'RSA' },
        },
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects a publicKey.publicKeyJwk containing a secret component (d)', () => {
    expect(
      parsePairingSubmission({
        ...validSubmission,
        publicKey: {
          ...validPublicKey,
          publicKeyJwk: { ...validJwk, d: 'secret-component' },
        },
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects an oversized body (>8 KiB) even when every checked field is within its own bound', () => {
    // Every individually-checked field here is within its own bound, but an
    // unexpected extra key inflates the serialized body past 8 KiB. Only a
    // whole-body byte-size check (not per-field bounds) can catch this.
    const oversized = {
      ...validSubmission,
      unexpectedJunk: 'x'.repeat(9000),
    };
    expect(parsePairingSubmission(oversized)).toEqual({ error: 'malformed' });
  });
});

describe('parseOwnershipChallenge', () => {
  describe('non-object input', () => {
    it.each([null, [], 'a string', 42, undefined])('rejects %p', (value) => {
      expect(parseOwnershipChallenge(value)).toEqual({ error: 'malformed' });
    });
  });

  it('accepts a valid challenge with all fields intact', () => {
    expect(parseOwnershipChallenge(validChallenge)).toEqual(validChallenge);
  });

  it('rejects when registrationCode is missing', () => {
    const { registrationCode: _omitted, ...rest } = validChallenge;
    expect(parseOwnershipChallenge(rest)).toEqual({ error: 'malformed' });
  });

  it('accepts a challenge of exactly 32 characters', () => {
    expect(
      parseOwnershipChallenge({ ...validChallenge, challenge: challenge32 }),
    ).toEqual({ ...validChallenge, challenge: challenge32 });
  });

  it('accepts a challenge of exactly 128 characters', () => {
    expect(
      parseOwnershipChallenge({ ...validChallenge, challenge: challenge128 }),
    ).toEqual({ ...validChallenge, challenge: challenge128 });
  });

  it('rejects a challenge of 31 characters (below the minimum)', () => {
    expect(
      parseOwnershipChallenge({
        ...validChallenge,
        challenge: 'A'.repeat(31),
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects a challenge of 129 characters (above the maximum)', () => {
    expect(
      parseOwnershipChallenge({
        ...validChallenge,
        challenge: 'A'.repeat(129),
      }),
    ).toEqual({ error: 'malformed' });
  });

  it.each([
    '+',
    '/',
    '=',
    ' ',
  ])('rejects a challenge containing a non-base64url character (%s)', (badChar) => {
    const challenge = `${'A'.repeat(31)}${badChar}`;
    expect(parseOwnershipChallenge({ ...validChallenge, challenge })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects an oversized body (>8 KiB) even when challenge/registrationCode are within their own bounds', () => {
    const oversized = {
      ...validChallenge,
      unexpectedJunk: 'x'.repeat(9000),
    };
    expect(parseOwnershipChallenge(oversized)).toEqual({ error: 'malformed' });
  });
});

describe('parseChallengeResponse', () => {
  // 86 chars: what a base64url-no-padding encoding of a 64-byte Ed25519
  // signature actually produces.
  const signature86 = 'A'.repeat(86);
  const validResponse = {
    challenge: challenge32,
    challengeSignature: signature86,
  };

  describe('non-object input', () => {
    it.each([null, [], 'a string', 42, undefined])('rejects %p', (value) => {
      expect(parseChallengeResponse(value)).toEqual({ error: 'malformed' });
    });
  });

  it('accepts a valid challenge response', () => {
    expect(parseChallengeResponse(validResponse)).toEqual(validResponse);
  });

  it('accepts a challenge of exactly 128 characters', () => {
    expect(
      parseChallengeResponse({ ...validResponse, challenge: challenge128 }),
    ).toEqual({ ...validResponse, challenge: challenge128 });
  });

  it('rejects when challenge is missing', () => {
    const { challenge: _omit, ...rest } = validResponse;
    expect(parseChallengeResponse(rest)).toEqual({ error: 'malformed' });
  });

  it('rejects when challengeSignature is missing', () => {
    const { challengeSignature: _omit, ...rest } = validResponse;
    expect(parseChallengeResponse(rest)).toEqual({ error: 'malformed' });
  });

  it('rejects a challenge of 31 characters (below the minimum)', () => {
    expect(
      parseChallengeResponse({ ...validResponse, challenge: 'A'.repeat(31) }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects a challenge of 129 characters (above the maximum)', () => {
    expect(
      parseChallengeResponse({ ...validResponse, challenge: 'A'.repeat(129) }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects a challenge containing a non-base64url character', () => {
    expect(
      parseChallengeResponse({
        ...validResponse,
        challenge: `${'A'.repeat(31)}+`,
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects an oversized challengeSignature', () => {
    expect(
      parseChallengeResponse({
        ...validResponse,
        challengeSignature: 'A'.repeat(129),
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects a challengeSignature containing a non-base64url character', () => {
    expect(
      parseChallengeResponse({
        ...validResponse,
        challengeSignature: `${'A'.repeat(85)}+`,
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects a wrong-typed challengeSignature', () => {
    expect(
      parseChallengeResponse({ ...validResponse, challengeSignature: 123 }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects an oversized body (>8 KiB) even when every checked field is within its own bound', () => {
    const oversized = {
      ...validResponse,
      unexpectedJunk: 'x'.repeat(9000),
    };
    expect(parseChallengeResponse(oversized)).toEqual({ error: 'malformed' });
  });
});
