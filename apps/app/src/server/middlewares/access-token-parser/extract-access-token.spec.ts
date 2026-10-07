import type { IncomingHttpHeaders } from 'node:http';
import type { AccessTokenParserReq } from '@growi/core/dist/interfaces/server';

import {
  extractAccessToken,
  X_GROWI_ACCESS_TOKEN_HEADER_NAME,
} from './extract-access-token';

// Build a minimal request shaped like the real Express request: only explicitly-set
// properties exist, so unset sources are genuinely `undefined` (unlike a deep auto-mock,
// which would stub every accessed path and break the `??` precedence chain).
const buildReq = (parts: {
  headers?: IncomingHttpHeaders;
  query?: { access_token?: string };
  body?: { access_token?: string };
}): AccessTokenParserReq =>
  ({
    headers: parts.headers ?? {},
    query: parts.query ?? {},
    body: parts.body ?? {},
  }) as AccessTokenParserReq;

describe('extractAccessToken', () => {
  it('returns the Bearer token when present, even if other sources exist (3.1)', () => {
    // arrange
    const req = buildReq({
      headers: {
        authorization: 'Bearer bearer-token',
        [X_GROWI_ACCESS_TOKEN_HEADER_NAME]: 'header-token',
      },
      query: { access_token: 'query-token' },
      body: { access_token: 'body-token' },
    });

    // act / assert
    expect(extractAccessToken(req)).toBe('bearer-token');
  });

  it('returns the header token when no Bearer is present (3.2)', () => {
    // arrange
    const req = buildReq({
      headers: { [X_GROWI_ACCESS_TOKEN_HEADER_NAME]: 'header-token' },
      query: { access_token: 'query-token' },
      body: { access_token: 'body-token' },
    });

    // act / assert
    expect(extractAccessToken(req)).toBe('header-token');
  });

  it('returns the query token when no Bearer and no header (3.3)', () => {
    // arrange
    const req = buildReq({
      headers: {},
      query: { access_token: 'query-token' },
      body: { access_token: 'body-token' },
    });

    // act / assert
    expect(extractAccessToken(req)).toBe('query-token');
  });

  it('returns the body token when only the body has it (3.3)', () => {
    // arrange
    const req = buildReq({
      headers: {},
      query: {},
      body: { access_token: 'body-token' },
    });

    // act / assert
    expect(extractAccessToken(req)).toBe('body-token');
  });

  it('ignores an array-valued (non-string) header and falls through to query (3.4)', () => {
    // arrange
    // Express represents repeated headers as string[]; a non-string header value must be
    // skipped so resolution continues to the remaining sources rather than failing.
    const req = buildReq({
      headers: { [X_GROWI_ACCESS_TOKEN_HEADER_NAME]: ['a', 'b'] },
      query: { access_token: 'query-token' },
      body: {},
    });

    // act / assert
    expect(extractAccessToken(req)).toBe('query-token');
  });

  it('returns null when the only source is an array-valued header (3.4)', () => {
    // arrange
    const req = buildReq({
      headers: { [X_GROWI_ACCESS_TOKEN_HEADER_NAME]: ['a', 'b'] },
      query: {},
      body: {},
    });

    // act / assert
    expect(extractAccessToken(req)).toBeNull();
  });

  it('returns null when no string-typed source is present (3.4)', () => {
    // arrange
    const req = buildReq({ headers: {}, query: {}, body: {} });

    // act / assert
    expect(extractAccessToken(req)).toBeNull();
  });

  it('resolves the header case-insensitively via the lowercase constant (1.3)', () => {
    // arrange
    // Express lowercases incoming header keys, so the canonical constant is lowercase;
    // indexing by it resolves a header regardless of the sender's casing.
    const req = buildReq({
      headers: { 'x-growi-access-token': 'header-token' },
      query: {},
      body: {},
    });

    // act / assert
    expect(X_GROWI_ACCESS_TOKEN_HEADER_NAME).toBe('x-growi-access-token');
    expect(extractAccessToken(req)).toBe('header-token');
  });

  it('matches the prior Bearer/query/body precedence when no header is present', () => {
    // arrange
    const req = buildReq({
      headers: { authorization: 'Bearer bearer-token' },
      query: { access_token: 'query-token' },
      body: { access_token: 'body-token' },
    });

    // act / assert
    expect(extractAccessToken(req)).toBe('bearer-token');
  });
});
