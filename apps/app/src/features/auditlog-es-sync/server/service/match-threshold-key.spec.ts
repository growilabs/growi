import {
  compileThresholdKeyPatterns,
  matchThresholdKey,
} from './match-threshold-key';

describe('matchThresholdKey', () => {
  const patterns = compileThresholdKeyPatterns([
    '/login',
    '/register',
    '/forgot-password/.*',
  ]);

  it('matches an exact-path key', () => {
    expect(matchThresholdKey(patterns, '/login')).toBe('/login');
  });

  it('does not match a key as a prefix', () => {
    expect(matchThresholdKey(patterns, '/login/callback')).toBeUndefined();
  });

  it('matches a dynamic-segment key', () => {
    expect(matchThresholdKey(patterns, '/forgot-password/abc123')).toBe(
      '/forgot-password/.*',
    );
  });

  it('strips the query string before matching', () => {
    expect(matchThresholdKey(patterns, '/login?access_token=secret')).toBe(
      '/login',
    );
  });

  it('returns undefined for an endpoint with no configured key', () => {
    expect(matchThresholdKey(patterns, '/_api/v3/pages')).toBeUndefined();
  });
});
