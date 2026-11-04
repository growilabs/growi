import { describe, expect, it, vi } from 'vitest';

import { anonymizeUrl } from './anonymize-url';
import type { AnonymizationRules } from './rules/types';

// Fails inside the real hashPagePath, so a swallowed hash error would surface
// as the plaintext path instead of the fixed failure value.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    createHash: () => {
      throw new Error('hash unavailable');
    },
  };
});

const rules: AnonymizationRules = {
  pathRules: [
    {
      id: 'page-view',
      matches: () => true,
      action: { kind: 'hash-page-path' },
    },
  ],
  sensitiveQueryParams: [],
};

describe('anonymizeUrl when page path hashing fails', () => {
  it('returns the fixed failure value instead of the plaintext path', () => {
    expect(anonymizeUrl('/wiki/secret-page', rules)).toBe(
      '/[ANONYMIZATION_FAILED]',
    );
  });
});
