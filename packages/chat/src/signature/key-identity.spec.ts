import { describe, expect, it } from 'vitest';

import {
  decodeKeyId,
  encodeKeyId,
  isValidKeyIdShape,
  type KeyRef,
} from './key-identity';

describe('encodeKeyId / decodeKeyId', () => {
  it('round-trips a KeyRef through the wire form', () => {
    const ref: KeyRef = { relationId: 'rel-abc12345', keyId: 'key-abc12345' };
    const encoded = encodeKeyId(ref);
    expect(decodeKeyId(encoded)).toEqual(ref);
  });

  it('never resolves the same keyId across two different relations to the same KeyRef (Requirement 8.1, 10.5)', () => {
    // Two different GROWI instances (different relations) happen to register
    // the same keyId. If the identifier collapsed to keyId alone, decoding
    // either encoded form would be ambiguous -- exactly the failure mode
    // design.md warns about for a hub proxy serving many GROWI instances.
    const refA: KeyRef = {
      relationId: 'relation-aaaaaaaa',
      keyId: 'shared-key-name1',
    };
    const refB: KeyRef = {
      relationId: 'relation-bbbbbbbb',
      keyId: 'shared-key-name1',
    };

    const encodedA = encodeKeyId(refA);
    const encodedB = encodeKeyId(refB);

    expect(encodedA).not.toBe(encodedB);
    expect(decodeKeyId(encodedA)).toEqual(refA);
    expect(decodeKeyId(encodedB)).toEqual(refB);
    // Decoding one must never produce the other relation's ref.
    expect(decodeKeyId(encodedA)).not.toEqual(refB);
    expect(decodeKeyId(encodedB)).not.toEqual(refA);
  });

  it('splits at the first colon, so a relationId cannot swallow the separator', () => {
    const ref: KeyRef = {
      relationId: 'relation-one',
      keyId: 'key-with-no-colon1',
    };
    const encoded = encodeKeyId(ref);
    expect(encoded).toBe('relation-one:key-with-no-colon1');
    expect(decodeKeyId(encoded)).toEqual(ref);
  });

  it('returns null when there is no colon at all', () => {
    expect(decodeKeyId('no-colon-here')).toBeNull();
  });

  it('returns null when the relationId side is empty', () => {
    expect(decodeKeyId(':key-abc12345')).toBeNull();
  });

  it('returns null when the keyId side is empty', () => {
    expect(decodeKeyId('relation-abc12345:')).toBeNull();
  });

  it('returns null when the keyId side contains another colon (a keyId that tried to shift the separator)', () => {
    // design.md: without validating keyId's charset at registration time, a
    // counterparty could register a keyId containing ':' and shift where the
    // separator falls. decodeKeyId defends the decode side by rejecting a
    // second colon outright.
    expect(decodeKeyId('relation-abc12345:key-part-a:key-part-b')).toBeNull();
  });
});

describe('isValidKeyIdShape', () => {
  it('accepts a keyId made only of [A-Za-z0-9_-] within 8-64 characters', () => {
    expect(isValidKeyIdShape('Abc-123_XYZ')).toBe(true);
    expect(isValidKeyIdShape('a'.repeat(8))).toBe(true);
    expect(isValidKeyIdShape('a'.repeat(64))).toBe(true);
  });

  it('rejects a keyId shorter than 8 characters', () => {
    expect(isValidKeyIdShape('a'.repeat(7))).toBe(false);
  });

  it('rejects a keyId longer than 64 characters', () => {
    expect(isValidKeyIdShape('a'.repeat(65))).toBe(false);
  });

  it('rejects a keyId containing a colon (the wire separator)', () => {
    expect(isValidKeyIdShape('abc12345:extra')).toBe(false);
  });

  it('rejects a keyId containing characters outside [A-Za-z0-9_-]', () => {
    expect(isValidKeyIdShape('abc 12345')).toBe(false);
    expect(isValidKeyIdShape('abc/12345')).toBe(false);
    expect(isValidKeyIdShape('abc.12345')).toBe(false);
  });
});
