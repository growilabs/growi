import { describe, expect, it } from 'vitest';

import { redactAccessTokenFromEndpoint } from './redact-access-token-from-endpoint';

describe('redactAccessTokenFromEndpoint', () => {
  it('redacts an access_token query parameter', () => {
    expect(
      redactAccessTokenFromEndpoint('/_api/v3/pages?access_token=secret'),
    ).toBe('/_api/v3/pages?access_token=[REDACTED]');
  });

  it('preserves other query parameters alongside a redacted one', () => {
    expect(
      redactAccessTokenFromEndpoint(
        '/_api/v3/pages?revisionId=abc&access_token=secret',
      ),
    ).toBe('/_api/v3/pages?revisionId=abc&access_token=[REDACTED]');
  });

  it('keeps the encoding of other query parameters unchanged', () => {
    expect(
      redactAccessTokenFromEndpoint(
        '/_api/search?q=a%20b&flag&access_token=secret',
      ),
    ).toBe('/_api/search?q=a%20b&flag&access_token=[REDACTED]');
  });

  it('redacts a percent-encoded access_token key, which Express still reads as access_token', () => {
    expect(
      redactAccessTokenFromEndpoint('/_api/v3/pages?access%5Ftoken=secret'),
    ).toBe('/_api/v3/pages?access%5Ftoken=[REDACTED]');
  });

  it('redacts every occurrence of a repeated access_token parameter', () => {
    expect(
      redactAccessTokenFromEndpoint(
        '/_api/v3/pages?access_token=one&access_token=two',
      ),
    ).toBe('/_api/v3/pages?access_token=[REDACTED]&access_token=[REDACTED]');
  });

  it('returns the URL unchanged when there is no query string', () => {
    expect(redactAccessTokenFromEndpoint('/_api/v3/login')).toBe(
      '/_api/v3/login',
    );
  });

  it('returns the URL unchanged when there is no sensitive parameter', () => {
    expect(redactAccessTokenFromEndpoint('/_api/v3/pages?revisionId=abc')).toBe(
      '/_api/v3/pages?revisionId=abc',
    );
  });
});
