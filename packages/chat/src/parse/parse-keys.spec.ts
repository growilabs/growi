import { describe, expect, it } from 'vitest';

import { OP_NAMES } from '../endpoints/op-names.js';
import { parseKeyRegistration, parseKeyRevocation } from './parse-keys.js';

const validJwk = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: 'base64url-public-component',
};

describe('parseKeyRegistration', () => {
  const valid = {
    relationId: 'rel-1',
    op: 'key-register-to-growi',
    key: {
      keyId: 'abcdefgh12345678',
      publicKeyJwk: validJwk,
      validFrom: '2026-01-01T00:00:00.000Z',
    },
  };

  describe('non-object input', () => {
    it.each([null, [], 'a string', 42, undefined])('rejects %p', (value) => {
      expect(parseKeyRegistration(value)).toEqual({ error: 'malformed' });
    });
  });

  it('accepts a valid request and retains relationId/op', () => {
    const result = parseKeyRegistration(valid);
    expect(result).toEqual(valid);
    if (!('error' in result)) {
      expect(result.relationId).toBe('rel-1');
      expect(result.op).toBe('key-register-to-growi');
    }
  });

  it('accepts the other allowed direction (key-register-to-proxy)', () => {
    const other = { ...valid, op: 'key-register-to-proxy' };
    expect(parseKeyRegistration(other)).toEqual(other);
  });

  it.each([
    'relationId',
    'key',
  ] as const)('rejects when %s is missing', (key) => {
    const { [key]: _omit, ...rest } = valid;
    expect(parseKeyRegistration(rest)).toEqual({ error: 'malformed' });
  });

  it('rejects when op is missing', () => {
    const { op: _omit, ...rest } = valid;
    expect(parseKeyRegistration(rest)).toEqual({ error: 'malformed' });
  });

  it('rejects an op that is not a real OP_NAMES member', () => {
    expect(parseKeyRegistration({ ...valid, op: 'nope' })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects an op that IS a real OP_NAMES member but not allowed for this endpoint', () => {
    // 'notification' is a real OP_NAMES value, but not one of the 2 allowed
    // here, and neither is 'key-revoke-to-growi' (a *sibling* key op).
    expect(parseKeyRegistration({ ...valid, op: 'notification' })).toEqual({
      error: 'malformed',
    });
    expect(
      parseKeyRegistration({ ...valid, op: 'key-revoke-to-growi' }),
    ).toEqual({
      error: 'malformed',
    });
  });

  it.each(
    Object.values(OP_NAMES).filter(
      (op) =>
        op !== OP_NAMES.keyRegisterToGrowi &&
        op !== OP_NAMES.keyRegisterToProxy,
    ),
  )('rejects every other real OP_NAMES member: %s', (op) => {
    expect(parseKeyRegistration({ ...valid, op })).toEqual({
      error: 'malformed',
    });
  });

  it.each([
    'keyId',
    'publicKeyJwk',
    'validFrom',
  ] as const)('rejects when key.%s is missing', (field) => {
    const { [field]: _omit, ...restKey } = valid.key;
    expect(parseKeyRegistration({ ...valid, key: restKey })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects a keyId failing isValidKeyIdShape (too short)', () => {
    expect(
      parseKeyRegistration({ ...valid, key: { ...valid.key, keyId: 'short' } }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects a keyId failing isValidKeyIdShape (disallowed character)', () => {
    expect(
      parseKeyRegistration({
        ...valid,
        key: { ...valid.key, keyId: 'abc12345:extra' },
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects a publicKeyJwk with the wrong kty (real isValidPublicKeyMaterial call, not mocked)', () => {
    expect(
      parseKeyRegistration({
        ...valid,
        key: {
          ...valid.key,
          publicKeyJwk: { kty: 'RSA', crv: 'Ed25519', x: 'x' },
        },
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects a publicKeyJwk carrying a secret component (real isValidPublicKeyMaterial call, not mocked)', () => {
    expect(
      parseKeyRegistration({
        ...valid,
        key: { ...valid.key, publicKeyJwk: { ...validJwk, d: 'secret' } },
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects a non-object publicKeyJwk', () => {
    expect(
      parseKeyRegistration({
        ...valid,
        key: { ...valid.key, publicKeyJwk: 'not-an-object' },
      }),
    ).toEqual({ error: 'malformed' });
  });

  it('rejects an oversized relationId', () => {
    expect(
      parseKeyRegistration({ ...valid, relationId: 'x'.repeat(1000) }),
    ).toEqual({ error: 'malformed' });
  });
});

describe('parseKeyRevocation', () => {
  const valid = {
    relationId: 'rel-1',
    op: 'key-revoke-to-growi',
    keyId: 'abcdefgh12345678',
  };

  describe('non-object input', () => {
    it.each([null, [], 'a string', 42, undefined])('rejects %p', (value) => {
      expect(parseKeyRevocation(value)).toEqual({ error: 'malformed' });
    });
  });

  it('accepts a valid request and retains relationId/op', () => {
    const result = parseKeyRevocation(valid);
    expect(result).toEqual(valid);
    if (!('error' in result)) {
      expect(result.relationId).toBe('rel-1');
      expect(result.op).toBe('key-revoke-to-growi');
    }
  });

  it('accepts the other allowed direction (key-revoke-to-proxy)', () => {
    const other = { ...valid, op: 'key-revoke-to-proxy' };
    expect(parseKeyRevocation(other)).toEqual(other);
  });

  it.each([
    'relationId',
    'keyId',
  ] as const)('rejects when %s is missing', (key) => {
    const { [key]: _omit, ...rest } = valid;
    expect(parseKeyRevocation(rest)).toEqual({ error: 'malformed' });
  });

  it('rejects when op is missing', () => {
    const { op: _omit, ...rest } = valid;
    expect(parseKeyRevocation(rest)).toEqual({ error: 'malformed' });
  });

  it('rejects an op that is not a real OP_NAMES member', () => {
    expect(parseKeyRevocation({ ...valid, op: 'nope' })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects an op that IS a real OP_NAMES member but not allowed for this endpoint', () => {
    expect(
      parseKeyRevocation({ ...valid, op: 'key-register-to-growi' }),
    ).toEqual({
      error: 'malformed',
    });
  });

  it.each(
    Object.values(OP_NAMES).filter(
      (op) =>
        op !== OP_NAMES.keyRevokeToGrowi && op !== OP_NAMES.keyRevokeToProxy,
    ),
  )('rejects every other real OP_NAMES member: %s', (op) => {
    expect(parseKeyRevocation({ ...valid, op })).toEqual({
      error: 'malformed',
    });
  });

  it('rejects a keyId failing isValidKeyIdShape (real function call, not re-derived here)', () => {
    expect(parseKeyRevocation({ ...valid, keyId: 'short' })).toEqual({
      error: 'malformed',
    });
  });
});
