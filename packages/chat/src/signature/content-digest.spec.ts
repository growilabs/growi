import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  CONTENT_DIGEST_ALGORITHM,
  computeContentDigest,
} from './content-digest.js';

/** Independently computed, so the assertion does not lean on the implementation. */
const expectedHeaderValue = (body: Uint8Array): string =>
  `sha-512=:${createHash('sha512').update(body).digest('base64')}:`;

describe('CONTENT_DIGEST_ALGORITHM', () => {
  it('is sha-512', () => {
    expect(CONTENT_DIGEST_ALGORITHM).toBe('sha-512');
  });
});

describe('computeContentDigest', () => {
  it('produces the RFC 9530 header value for the body bytes', () => {
    const body = new TextEncoder().encode(
      '{"relationId":"rel-1","op":"command"}',
    );

    expect(computeContentDigest(body)).toBe(expectedHeaderValue(body));
  });

  it('is a well-formed Structured Fields Dictionary with a sha-512 Byte Sequence member', () => {
    const body = new TextEncoder().encode('hello');

    // `sha-512=:<base64>:` -- exactly one member, value in sf-binary form.
    expect(computeContentDigest(body)).toMatch(
      /^sha-512=:[A-Za-z0-9+/]+={0,2}:$/,
    );
  });

  it('returns the same value for the same body bytes', () => {
    const body = new TextEncoder().encode('same body');

    expect(computeContentDigest(body)).toBe(
      computeContentDigest(new TextEncoder().encode('same body')),
    );
  });

  it('returns a different value for different body bytes', () => {
    expect(computeContentDigest(new TextEncoder().encode('a'))).not.toBe(
      computeContentDigest(new TextEncoder().encode('b')),
    );
  });

  it('covers the whole body -- a change in the last byte changes the value', () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    const tampered = new Uint8Array([1, 2, 3, 5]);

    expect(computeContentDigest(body)).not.toBe(computeContentDigest(tampered));
  });

  it('handles an empty body with the well-defined SHA-512 of no input', () => {
    const empty = new Uint8Array(0);

    expect(computeContentDigest(empty)).toBe(
      'sha-512=:z4PhNX7vuL3xVChQ1m2AB9Yg5AULVxXcg/SpIdNs6c5H0NE8XYXysP+DGNKHfuwvY7kxvUdBeoGlODJ6+SfaPg==:',
    );
  });
});
