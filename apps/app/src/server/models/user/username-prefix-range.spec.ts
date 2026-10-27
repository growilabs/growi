import { buildUsernamePrefixRange } from './username-prefix-range';

describe('buildUsernamePrefixRange', () => {
  it('bounds the range at both ends', () => {
    expect(buildUsernamePrefixRange('kaho')).toEqual({
      $gte: 'kaho',
      $lt: 'kaho￿',
    });
  });

  // Pinned as the wrong form only: JS compares code units, where `{` sorts above
  // `z`, so the broken bound looks correct to any assertion here. The real proof
  // is user.integ.ts > "matches a prefix ending in a high letter".
  it.each([
    'kahz',
    'zz',
    'zzz',
    'abz',
  ])('does not close the range by incrementing the last character (%s)', (prefix) => {
    const incremented =
      prefix.slice(0, -1) +
      String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);

    expect(buildUsernamePrefixRange(prefix)?.$lt).not.toBe(incremented);
  });

  it("does not fold case — that is the collation's job", () => {
    // Lowercasing here would break matching against usernames stored capitalised,
    // because the range would then be compared against the wrong endpoints.
    expect(buildUsernamePrefixRange('Kaho')?.$gte).toBe('Kaho');
  });

  it('returns no range for an empty keyword', () => {
    // The caller omits the username condition entirely, so every username
    // qualifies — the endpoint's pre-existing behaviour for an empty `q`.
    expect(buildUsernamePrefixRange('')).toBeNull();
  });

  it.each([
    'kaho-',
    'a.',
    'a_',
    'x',
  ])('handles separators and single characters (%s)', (prefix) => {
    expect(buildUsernamePrefixRange(prefix)).toEqual({
      $gte: prefix,
      $lt: `${prefix}￿`,
    });
  });
});
