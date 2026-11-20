import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { INFRA_NOISE_PATTERNS, match } from './denylist.ts';
import { extractFailBlocks } from './job-log.ts';

const readFixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../fixtures/job-logs/${name}`, import.meta.url)),
    'utf8',
  );

/** Constructed: 97 failures in one job log, one of them infrastructure noise. */
const MANY_FAILURES = readFixture(
  'constructed-97-failures-one-infra-noise-excerpt.txt',
);
/** Constructed: the same denylist string, inside a shared setup hook. */
const SETUP_HOOK_NOISE = readFixture(
  'constructed-setup-hook-infra-noise-excerpt.txt',
);

describe('denylist.match', () => {
  it('names which pattern matched, case-insensitively', () => {
    expect(match('Error: connect econnrefused 127.0.0.1:27017')).toMatchObject({
      pattern: 'ECONNREFUSED',
      scope: 'failure',
    });
  });

  it('returns null for an ordinary assertion failure', () => {
    expect(match('AssertionError: expected 200 to be 201')).toBeNull();
  });

  it('scopes a match inside a shared setup hook to the whole job', () => {
    const blocks = extractFailBlocks(SETUP_HOOK_NOISE);
    const hookBlock = blocks[0];

    expect(hookBlock?.sharedSetupHook).toBe(true);
    expect(match(hookBlock?.excerpt ?? '')).toMatchObject({
      pattern: 'getaddrinfo ENOTFOUND',
      scope: 'job',
    });
  });

  it('scopes a match outside a shared setup hook to that failure alone — 1 hit among 97 failures', () => {
    const blocks = extractFailBlocks(MANY_FAILURES);
    expect(blocks).toHaveLength(97);

    const hits = blocks
      .map((block, index) => ({ index, hit: match(block.excerpt) }))
      .filter((entry) => entry.hit != null);

    expect(hits).toHaveLength(1);
    expect(hits[0]?.index).toBe(42);
    expect(hits[0]?.hit).toMatchObject({
      pattern: 'getaddrinfo ENOTFOUND',
      scope: 'failure',
    });
    expect(blocks[42]?.specPath).toBe(
      'src/server/service/feature-43/feature-43.integ.ts',
    );
  });

  it('takes the pattern list as an argument so a caller can match against its own list', () => {
    const custom = [{ name: 'my noise', needles: ['a very specific string'] }];

    expect(match('boom: a very specific string', custom)).toMatchObject({
      pattern: 'my noise',
      needle: 'a very specific string',
    });
    expect(match('Error: connect ECONNREFUSED', custom)).toBeNull();
  });

  it('matches a pattern carrying more than one needle on either of them', () => {
    const oom = INFRA_NOISE_PATTERNS.find(
      (pattern) => pattern.needles.length > 1,
    );

    expect(oom).toBeDefined();
    for (const needle of oom?.needles ?? []) {
      expect(match(`worker crashed: ${needle}`)).toMatchObject({
        pattern: oom?.name,
        needle,
      });
    }
  });
});

describe('denylist.INFRA_NOISE_PATTERNS', () => {
  it('carries every pattern the procedure listed as infrastructure noise', () => {
    const names = INFRA_NOISE_PATTERNS.map((pattern) => pattern.name);

    expect(names).toEqual([
      'ECONNREFUSED',
      'getaddrinfo ENOTFOUND',
      'No space left on device',
      'OOM-killed',
      'runner lost',
      'docker daemon error',
      'Failed to download file.',
    ]);
  });

  it('declares at least one non-empty needle per pattern', () => {
    for (const pattern of INFRA_NOISE_PATTERNS) {
      expect(pattern.needles.length).toBeGreaterThan(0);
      for (const needle of pattern.needles) {
        expect(needle.trim()).not.toBe('');
      }
    }
  });
});
