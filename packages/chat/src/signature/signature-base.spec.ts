import { describe, expect, it } from 'vitest';

import { computeContentDigest } from './content-digest.js';
import { buildSignatureBase } from './signature-base.js';

// RFC 9421 appendix B.2 `test-request`. The RFC prints long values folded per
// RFC 8792 (a trailing `\`, a newline and two leading spaces are removed on
// rejoin); the values below are already rejoined. The digest is cross-checked
// against `node:crypto` by the first test so a transcription slip cannot go
// unnoticed.
const TEST_REQUEST_BODY = '{"hello": "world"}';
const TEST_REQUEST_CONTENT_DIGEST =
  'sha-512=:WZDPaVn/7XgHaAy8pmojAkGWoRx2UFChF41A2svX+TaPm+AbwAgBWnrIiYllu7BNNyealdVLvRwEmTHWXvJwew==:';

const testRequestMessage = {
  method: 'POST',
  headers: {
    Host: 'example.com',
    Date: 'Tue, 20 Apr 2021 02:07:55 GMT',
    'Content-Type': 'application/json',
    'Content-Digest': TEST_REQUEST_CONTENT_DIGEST,
    'Content-Length': '18',
  },
  derivedComponents: {
    '@authority': 'example.com',
    '@path': '/foo',
  },
};

describe('buildSignatureBase — RFC 9421 published test vectors', () => {
  it('reproduces the transcribed Content-Digest from the body itself', () => {
    expect(computeContentDigest(Buffer.from(TEST_REQUEST_BODY, 'utf8'))).toBe(
      TEST_REQUEST_CONTENT_DIGEST,
    );
  });

  it('matches RFC 9421 section 2.5 figure 1 byte for byte', () => {
    const base = buildSignatureBase(
      [
        '@method',
        '@authority',
        '@path',
        'content-digest',
        'content-length',
        'content-type',
      ],
      testRequestMessage,
      new Map<string, number | string>([
        ['created', 1618884473],
        ['keyid', 'test-key-rsa-pss'],
      ]),
    );

    expect(base).toBe(
      [
        '"@method": POST',
        '"@authority": example.com',
        '"@path": /foo',
        `"content-digest": ${TEST_REQUEST_CONTENT_DIGEST}`,
        '"content-length": 18',
        '"content-type": application/json',
        '"@signature-params": ("@method" "@authority" "@path" "content-digest" "content-length" "content-type");created=1618884473;keyid="test-key-rsa-pss"',
      ].join('\n'),
    );
  });

  it('matches RFC 9421 appendix B.2.6 (ed25519) byte for byte', () => {
    const base = buildSignatureBase(
      [
        'date',
        '@method',
        '@path',
        '@authority',
        'content-type',
        'content-length',
      ],
      testRequestMessage,
      new Map<string, number | string>([
        ['created', 1618884473],
        ['keyid', 'test-key-ed25519'],
      ]),
    );

    expect(base).toBe(
      [
        '"date": Tue, 20 Apr 2021 02:07:55 GMT',
        '"@method": POST',
        '"@path": /foo',
        '"@authority": example.com',
        '"content-type": application/json',
        '"content-length": 18',
        '"@signature-params": ("date" "@method" "@path" "@authority" "content-type" "content-length");created=1618884473;keyid="test-key-ed25519"',
      ].join('\n'),
    );
  });

  it('matches RFC 9421 appendix B.2.1 (empty covered component list)', () => {
    const base = buildSignatureBase(
      [],
      testRequestMessage,
      new Map<string, number | string>([
        ['created', 1618884473],
        ['keyid', 'test-key-rsa-pss'],
        ['nonce', 'b3k2pp5k7z-50gnwp.yemd'],
      ]),
    );

    // No component lines at all -- and therefore no leading empty line.
    expect(base).toBe(
      '"@signature-params": ();created=1618884473;keyid="test-key-rsa-pss";nonce="b3k2pp5k7z-50gnwp.yemd"',
    );
  });

  it("keeps the caller's order of the signature parameters (RFC 9421 section 4.3 proxy example)", () => {
    const base = buildSignatureBase(
      [
        '@method',
        '@authority',
        '@path',
        'content-digest',
        'content-type',
        'content-length',
        'forwarded',
      ],
      {
        ...testRequestMessage,
        headers: {
          ...testRequestMessage.headers,
          Forwarded: 'for=192.0.2.123;host=example.com;proto=https',
        },
        derivedComponents: {
          '@authority': 'origin.host.internal.example',
          '@path': '/foo',
        },
      },
      // `created`, `keyid`, `alg`, `expires` -- deliberately not this package's
      // own order, which is what proves the order comes from the caller.
      new Map<string, number | string>([
        ['created', 1618884480],
        ['keyid', 'test-key-rsa'],
        ['alg', 'rsa-v1_5-sha256'],
        ['expires', 1618884540],
      ]),
    );

    expect(base).toBe(
      [
        '"@method": POST',
        '"@authority": origin.host.internal.example',
        '"@path": /foo',
        `"content-digest": ${TEST_REQUEST_CONTENT_DIGEST}`,
        '"content-type": application/json',
        '"content-length": 18',
        '"forwarded": for=192.0.2.123;host=example.com;proto=https',
        '"@signature-params": ("@method" "@authority" "@path" "content-digest" "content-type" "content-length" "forwarded");created=1618884480;keyid="test-key-rsa";alg="rsa-v1_5-sha256";expires=1618884540',
      ].join('\n'),
    );
  });

  it('ends without a trailing newline (RFC 9421 section 2.5)', () => {
    const base = buildSignatureBase(
      ['@method'],
      testRequestMessage,
      new Map<string, number | string>([['created', 1618884473]]),
    );

    expect(base).toBe(
      '"@method": POST\n"@signature-params": ("@method");created=1618884473',
    );
  });
});

describe('buildSignatureBase — component values', () => {
  const params = new Map<string, number | string>([['created', 1]]);

  it('uppercases the method for `@method`', () => {
    expect(
      buildSignatureBase(['@method'], { method: 'post', headers: {} }, params),
    ).toContain('"@method": POST');
  });

  it('finds a header field whatever case the header name was given in', () => {
    expect(
      buildSignatureBase(
        ['content-type'],
        { method: 'POST', headers: { 'CoNtEnT-TyPe': 'application/json' } },
        params,
      ),
    ).toContain('"content-type": application/json');
  });

  it('strips the whitespace around a header field value', () => {
    expect(
      buildSignatureBase(
        ['content-type'],
        {
          method: 'POST',
          headers: { 'content-type': '  application/json \t' },
        },
        params,
      ),
    ).toContain('"content-type": application/json');
  });

  it('lowercases the component identifier it was given', () => {
    expect(
      buildSignatureBase(
        ['Content-Type'],
        { method: 'POST', headers: { 'content-type': 'application/json' } },
        params,
      ),
    ).toContain('"content-type": application/json');
  });
});

describe('buildSignatureBase — refusals', () => {
  const params = new Map<string, number | string>([['created', 1]]);

  it('throws when a covered header field is absent from the message', () => {
    expect(() =>
      buildSignatureBase(
        ['content-digest'],
        { method: 'POST', headers: {} },
        params,
      ),
    ).toThrow(/content-digest/);
  });

  it('throws when a covered derived component has no value', () => {
    expect(() =>
      buildSignatureBase(
        ['@authority'],
        { method: 'POST', headers: {} },
        params,
      ),
    ).toThrow(/@authority/);
  });

  it('throws when the same component is covered twice', () => {
    expect(() =>
      buildSignatureBase(
        ['@method', '@method'],
        { method: 'POST', headers: {} },
        params,
      ),
    ).toThrow(/@method/);
  });

  it('throws when `@signature-params` is listed as a covered component', () => {
    expect(() =>
      buildSignatureBase(
        ['@signature-params'],
        { method: 'POST', headers: {} },
        params,
      ),
    ).toThrow(/@signature-params/);
  });
});
