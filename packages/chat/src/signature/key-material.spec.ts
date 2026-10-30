import { describe, expect, it } from 'vitest';

import { isValidPublicKeyMaterial } from './key-material';

describe('isValidPublicKeyMaterial', () => {
  it('accepts an Ed25519 OKP public key with no secret component', () => {
    const result = isValidPublicKeyMaterial({
      kty: 'OKP',
      crv: 'Ed25519',
      x: 'base64url-public-component',
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects a key whose kty is not OKP', () => {
    const result = isValidPublicKeyMaterial({
      kty: 'EC',
      crv: 'Ed25519',
      x: 'base64url-public-component',
    });
    expect(result).toEqual({ ok: false, reason: 'wrong-key-type' });
  });

  it('rejects a key whose crv is not Ed25519', () => {
    const result = isValidPublicKeyMaterial({
      kty: 'OKP',
      crv: 'X25519',
      x: 'base64url-public-component',
    });
    expect(result).toEqual({ ok: false, reason: 'wrong-key-type' });
  });

  it('rejects a JsonWebKey that carries a private/secret component (d)', () => {
    // design.md: JsonWebKey is a wide type that also accepts a private key.
    // Registering one would leak the counterparty's private key material.
    const result = isValidPublicKeyMaterial({
      kty: 'OKP',
      crv: 'Ed25519',
      x: 'base64url-public-component',
      d: 'base64url-secret-component',
    });
    expect(result).toEqual({ ok: false, reason: 'contains-secret-component' });
  });

  it('rejects a key that is neither the right type nor secret-free, reporting the type failure first', () => {
    const result = isValidPublicKeyMaterial({
      kty: 'RSA',
      d: 'base64url-secret-component',
    });
    expect(result).toEqual({ ok: false, reason: 'wrong-key-type' });
  });
});
