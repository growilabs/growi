import { describe, expect, it } from 'vitest';

import { redactAccessTokenFromEndpoint } from './redact-access-token-from-endpoint';

describe('redactAccessTokenFromEndpoint', () => {
  it('redacts an access_token query parameter', () => {
    expect(
      redactAccessTokenFromEndpoint('/_api/v3/pages?access_token=secret'),
    ).toBe('/_api/v3/pages?access_token=%5BREDACTED%5D');
  });

  it('preserves other query parameters alongside a redacted one', () => {
    expect(
      redactAccessTokenFromEndpoint(
        '/_api/v3/pages?revisionId=abc&access_token=secret',
      ),
    ).toBe('/_api/v3/pages?revisionId=abc&access_token=%5BREDACTED%5D');
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
