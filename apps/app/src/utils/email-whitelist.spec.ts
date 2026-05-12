import { describe, expect, it } from 'vitest';

import {
  isEmailMatchedByEntry,
  isValidWhitelistEntry,
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
