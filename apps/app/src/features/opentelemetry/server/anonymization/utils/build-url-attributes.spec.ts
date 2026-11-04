import type { IncomingMessage } from 'node:http';
import { TLSSocket } from 'node:tls';
import { describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';

import {
  buildUrlAttributes,
  isStableHttpSemconvEnabled,
} from './build-url-attributes';

const TARGET = '/[HASHED:0123456789abcdef]?q=%5BANONYMIZED%5D';

describe('buildUrlAttributes', () => {
  it('should build http.url from the host header and the anonymized target', () => {
    const request = mock<IncomingMessage>({
      headers: { host: 'wiki.example.com' },
    });

    expect(buildUrlAttributes(request, TARGET, false)).toEqual({
      'http.url': `http://wiki.example.com${TARGET}`,
    });
  });

  it('should use the https scheme for a TLS connection', () => {
    const request = mock<IncomingMessage>({
      headers: { host: 'wiki.example.com' },
      socket: Object.create(TLSSocket.prototype),
    });

    expect(buildUrlAttributes(request, TARGET, false)['http.url']).toBe(
      `https://wiki.example.com${TARGET}`,
    );
  });

  it('should fall back to the target alone when there is no host header', () => {
    const request = mock<IncomingMessage>({ headers: { host: undefined } });

    expect(buildUrlAttributes(request, TARGET, false)['http.url']).toBe(TARGET);
  });

  it('should also build url.path and url.query when stable attributes are emitted', () => {
    const request = mock<IncomingMessage>({
      headers: { host: 'wiki.example.com' },
    });

    expect(buildUrlAttributes(request, TARGET, true)).toEqual({
      'http.url': `http://wiki.example.com${TARGET}`,
      'url.path': '/[HASHED:0123456789abcdef]',
      'url.query': 'q=%5BANONYMIZED%5D',
    });
  });

  it('should omit url.query when the target has no query string', () => {
    const request = mock<IncomingMessage>({
      headers: { host: 'wiki.example.com' },
    });

    expect(
      buildUrlAttributes(request, '/[HASHED:0123456789abcdef]', true),
    ).not.toHaveProperty('url.query');
  });
});

describe('isStableHttpSemconvEnabled', () => {
  it.each`
    optIn                  | expected
    ${undefined}           | ${false}
    ${''}                  | ${false}
    ${'database'}          | ${false}
    ${'http'}              | ${true}
    ${'http/dup'}          | ${true}
    ${'database, http'}    | ${true}
    ${'database,http/dup'} | ${true}
  `('should return $expected for "$optIn"', ({ optIn, expected }) => {
    expect(isStableHttpSemconvEnabled(optIn)).toBe(expected);
  });
});
