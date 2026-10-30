import { matchPathPattern, redactPathParams } from './path-pattern';

describe('matchPathPattern', () => {
  it('returns the value of each :name segment on a match', () => {
    expect(
      matchPathPattern(
        '/_api/v3/user-groups/:id/users/:username',
        '/_api/v3/user-groups/507f1f77bcf86cd799439011/users/alice',
      ),
    ).toEqual({ id: '507f1f77bcf86cd799439011', username: 'alice' });
  });

  it('returns an empty object when the pattern has no parameters', () => {
    expect(matchPathPattern('/a/b', '/a/b')).toEqual({});
  });

  it('returns null when a literal segment differs', () => {
    expect(matchPathPattern('/share/:linkId', '/other/abc')).toBeNull();
  });

  it('returns null when the segment count differs', () => {
    expect(matchPathPattern('/share/:linkId', '/share')).toBeNull();
    expect(matchPathPattern('/share/:linkId', '/share/a/b')).toBeNull();
  });

  it('does not match an empty segment', () => {
    expect(matchPathPattern('/share/:linkId', '/share/')).toBeNull();
    expect(matchPathPattern('/a/:x/b', '/a//b')).toBeNull();
  });

  it('matches a path with a trailing slash like Express does', () => {
    expect(matchPathPattern('/share/:linkId', '/share/abc/')).toEqual({
      linkId: 'abc',
    });
  });
});

describe('redactPathParams', () => {
  it('replaces only the named segments with [ANONYMIZED]', () => {
    expect(
      redactPathParams(
        '/_api/v3/user-groups/:id/users/:username',
        '/_api/v3/user-groups/507f1f77bcf86cd799439011/users/alice',
        ['username'],
      ),
    ).toBe('/_api/v3/user-groups/507f1f77bcf86cd799439011/users/[ANONYMIZED]');
  });

  it('replaces several named segments', () => {
    expect(redactPathParams('/a/:x/b/:y', '/a/1/b/2', ['x', 'y'])).toBe(
      '/a/[ANONYMIZED]/b/[ANONYMIZED]',
    );
  });

  it('returns the path unchanged when the pattern does not match', () => {
    expect(redactPathParams('/share/:linkId', '/other/abc', ['linkId'])).toBe(
      '/other/abc',
    );
  });

  it('ignores names that are not in the pattern', () => {
    expect(redactPathParams('/share/:linkId', '/share/abc', ['nope'])).toBe(
      '/share/abc',
    );
  });

  it('keeps a trailing slash', () => {
    expect(redactPathParams('/share/:linkId', '/share/abc/', ['linkId'])).toBe(
      '/share/[ANONYMIZED]/',
    );
  });
});
