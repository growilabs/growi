import { describe, expect, it } from 'vitest';

import {
  isEmailMatchedByEntry,
  isValidWhitelistEntry,
  normalizeWhitelistEntries,
  normalizeWhitelistEntry,
} from './email-whitelist';

describe('isValidWhitelistEntry', () => {
  describe('domain entries starting with @', () => {
    it.each([
      '@growi.org',
      '@a.b.c',
      '@example.com',
      '@sub.example.com',
    ])('accepts valid domain entry: %s', (entry) => {
      expect(isValidWhitelistEntry(entry)).toBe(true);
    });

    it.each([
      '@*.example.com',
      '@*.a.b.c',
    ])('accepts valid wildcard subdomain entry: %s', (entry) => {
      expect(isValidWhitelistEntry(entry)).toBe(true);
    });

    it.each([
      ['@-bad.com', 'label starts with hyphen'],
      ['@bad-.com', 'label ends with hyphen'],
      ['@example..com', 'consecutive dots'],
      ['@example.com.', 'trailing dot'],
      ['@.example.com', 'leading dot'],
      ['@example', 'no dot in domain'],
      ['@ example.com', 'space in entry'],
      ['@', 'bare @'],
      ['@*.com', 'wildcard with single-label base domain'],
    ])('rejects invalid domain entry: %s (%s)', (entry) => {
      expect(isValidWhitelistEntry(entry)).toBe(false);
    });
  });

  describe('exact email entries', () => {
    it.each([
      'user@growi.org',
      'User@GROWI.ORG',
    ])('accepts valid email: %s', (entry) => {
      expect(isValidWhitelistEntry(entry)).toBe(true);
    });

    it.each([
      [' user@growi.org', 'leading space'],
      ['user@growi.org ', 'trailing space'],
      ['user@growi', 'no TLD dot'],
      ['usergrowi.org', 'missing @'],
      ['user@-bad.com', 'domain label starts with hyphen'],
      ['user@bad-.com', 'domain label ends with hyphen'],
      ['user@example..com', 'consecutive dots in domain'],
    ])('rejects invalid email: %s (%s)', (entry) => {
      expect(isValidWhitelistEntry(entry)).toBe(false);
    });
  });
});

describe('isEmailMatchedByEntry', () => {
  describe('strict domain entry (@domain.com)', () => {
    it('matches email with exact domain', () => {
      expect(isEmailMatchedByEntry('user@growi.org', '@growi.org')).toBe(true);
    });

    it('matches case-insensitively (user@GROWI.ORG vs @growi.org)', () => {
      expect(isEmailMatchedByEntry('user@GROWI.ORG', '@growi.org')).toBe(true);
    });

    it('does not match subdomain (user@sub.example.com vs @example.com)', () => {
      expect(
        isEmailMatchedByEntry('user@sub.example.com', '@example.com'),
      ).toBe(false);
    });

    it('does not match domain that merely ends with the entry domain (evil@evilexample.com vs @example.com)', () => {
      expect(
        isEmailMatchedByEntry('evil@evilexample.com', '@example.com'),
      ).toBe(false);
    });
  });

  describe('wildcard subdomain entry (@*.domain.com)', () => {
    it('matches direct subdomain', () => {
      expect(
        isEmailMatchedByEntry('user@sub.example.com', '@*.example.com'),
      ).toBe(true);
    });

    it('matches nested subdomain', () => {
      expect(
        isEmailMatchedByEntry('user@a.b.example.com', '@*.example.com'),
      ).toBe(true);
    });

    it('does not match the root domain itself', () => {
      expect(isEmailMatchedByEntry('user@example.com', '@*.example.com')).toBe(
        false,
      );
    });

    it('does not match domain that merely ends with the base domain', () => {
      expect(
        isEmailMatchedByEntry('evil@evilexample.com', '@*.example.com'),
      ).toBe(false);
    });

    it('matches case-insensitively', () => {
      expect(
        isEmailMatchedByEntry('user@SUB.EXAMPLE.COM', '@*.example.com'),
      ).toBe(true);
    });
  });

  describe('exact email entry', () => {
    it('matches identical email', () => {
      expect(isEmailMatchedByEntry('user@growi.org', 'user@growi.org')).toBe(
        true,
      );
    });

    it('matches case-insensitively', () => {
      expect(isEmailMatchedByEntry('User@Growi.Org', 'user@growi.org')).toBe(
        true,
      );
    });

    it('does not match different local part', () => {
      expect(isEmailMatchedByEntry('other@growi.org', 'user@growi.org')).toBe(
        false,
      );
    });

    it('does not match different domain', () => {
      expect(isEmailMatchedByEntry('user@other.org', 'user@growi.org')).toBe(
        false,
      );
    });
  });
});

describe('normalizeWhitelistEntry', () => {
  it.each([
    ['growi.org', ['@growi.org', '@*.growi.org']],
    ['sub.example.com', ['@sub.example.com', '@*.sub.example.com']],
    ['a.b.c', ['@a.b.c', '@*.a.b.c']],
  ])('expands legacy bare-domain entry to exact + wildcard: %s -> %j', (input, expected) => {
    expect(normalizeWhitelistEntry(input)).toEqual(expected);
  });

  it('expands a bare wildcard domain to a single valid wildcard entry (no double wildcard)', () => {
    // `@*.*.example.com` is not a valid entry, so only the wildcard form is kept
    expect(normalizeWhitelistEntry('*.example.com')).toEqual([
      '@*.example.com',
    ]);
  });

  it.each([
    '@growi.org',
    '@*.example.com',
  ])('leaves valid domain entry untouched: %s', (entry) => {
    expect(normalizeWhitelistEntry(entry)).toEqual([entry]);
  });

  it.each([
    'user@growi.org',
    'User@GROWI.ORG',
  ])('leaves valid email entry untouched: %s', (entry) => {
    expect(normalizeWhitelistEntry(entry)).toEqual([entry]);
  });

  it('trims surrounding whitespace before normalizing', () => {
    expect(normalizeWhitelistEntry('  growi.org  ')).toEqual([
      '@growi.org',
      '@*.growi.org',
    ]);
  });

  it.each([
    ['example', 'single-label (no dot)'],
    ['not a domain', 'space in entry'],
    ['', 'empty string'],
  ])('returns unchanged when prepending @ does not form a valid entry: %s (%s)', (input) => {
    expect(normalizeWhitelistEntry(input)).toEqual([input.trim()]);
  });

  // Regression: a legacy bare-domain entry must match its users again after normalization.
  // Before the strict @-prefixed format, `growi.org` matched BOTH `user@growi.org` and
  // `user@sub.growi.org` (unanchored regex). The new matcher requires the leading @ and
  // separates exact vs subdomain, so the entry must expand to @growi.org + @*.growi.org
  // to fully reproduce the old behavior.
  describe('regression: normalized legacy bare domain matches its users', () => {
    const normalized = normalizeWhitelistEntry('growi.org');

    it('matches the root domain (growi.org -> user@growi.org)', () => {
      expect(
        normalized.some((entry) =>
          isEmailMatchedByEntry('user@growi.org', entry),
        ),
      ).toBe(true);
    });

    it('matches a subdomain (growi.org -> user@sub.growi.org)', () => {
      expect(
        normalized.some((entry) =>
          isEmailMatchedByEntry('user@sub.growi.org', entry),
        ),
      ).toBe(true);
    });
  });
});

describe('normalizeWhitelistEntries', () => {
  it('expands and de-duplicates a list of mixed entries', () => {
    expect(
      normalizeWhitelistEntries(['growi.org', 'user@example.com', '@foo.com']),
    ).toEqual(['@growi.org', '@*.growi.org', 'user@example.com', '@foo.com']);
  });

  it('de-duplicates when a bare domain and its normalized form coexist', () => {
    expect(normalizeWhitelistEntries(['@growi.org', 'growi.org'])).toEqual([
      '@growi.org',
      '@*.growi.org',
    ]);
  });

  it('returns an empty array unchanged', () => {
    expect(normalizeWhitelistEntries([])).toEqual([]);
  });

  it('leaves an already-normalized list unchanged', () => {
    const entries = ['@growi.org', '@*.growi.org', 'user@example.com'];
    expect(normalizeWhitelistEntries(entries)).toEqual(entries);
  });
});
