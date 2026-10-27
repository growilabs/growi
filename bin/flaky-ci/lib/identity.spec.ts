import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parse } from './identity.ts';

const readFixtureJson = (relativePath: string): unknown =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'),
  );

const REAL_TITLES = readFixtureJson(
  '../fixtures/identity/flaky-issue-titles.json',
) as readonly string[];

const EXPECTED_REAL_TITLES = readFixtureJson(
  '../fixtures/expected/parse-identity-key-titles.json',
) as ReadonlyArray<{
  readonly title: string;
  readonly parsed: ReturnType<typeof parse>;
}>;

const CONSTRUCTED = readFixtureJson(
  '../fixtures/identity/constructed-titles.json',
) as { readonly playwrightJobLevel: string; readonly malformedVitest: string };

describe('identity.parse — all 65 real flaky-tracking issue titles', () => {
  it('matches the recorded expectation for every real title, one at a time', () => {
    for (const { title, parsed } of EXPECTED_REAL_TITLES) {
      expect(parse(title)).toEqual(parsed);
    }
  });

  it('has an expectation row for every title in the corpus (no silent drop)', () => {
    expect(EXPECTED_REAL_TITLES.map((row) => row.title)).toEqual(REAL_TITLES);
  });

  it('classifies every real title as shape "precise" (this corpus carries no job-level fallback or malformed key)', () => {
    for (const title of REAL_TITLES) {
      expect(parse(title).shape).toBe('precise');
    }
  });
});

describe('identity.parse — named cases from tasks.md 3.3', () => {
  it('#11752: the shared setup-hook key uses the setup file itself as {SPEC_PATH}', () => {
    const result = parse(
      'flaky: vitest:test/setup/migrate-mongo.ts:beforeAll migration setup hook timeout (20000ms) during ci-app-test-integration',
    );
    expect(result).toEqual({
      shape: 'precise',
      kind: 'vitest',
      browser: null,
      specPath: 'test/setup/migrate-mongo.ts',
      testTitle:
        'beforeAll migration setup hook timeout (20000ms) during ci-app-test-integration',
    });
  });

  it('a Playwright title containing ":" is never split on the first/last colon', () => {
    const result = parse(
      'flaky: playwright:chromium:playwright/20-basic-features/inline-comment.spec.ts:Inline comment - visual refresh: mockup cross-check captures > Capture popover states 5 (normal) and 6 (edit mode) in DARK mode (Req 4.4)',
    );
    expect(result).toEqual({
      shape: 'precise',
      kind: 'playwright',
      browser: 'chromium',
      specPath: 'playwright/20-basic-features/inline-comment.spec.ts',
      testTitle:
        'Inline comment - visual refresh: mockup cross-check captures > Capture popover states 5 (normal) and 6 (edit mode) in DARK mode (Req 4.4)',
    });
  });

  it('#11818: a test title that itself names a ".js" file is not mistaken for the spec-path boundary', () => {
    const result = parse(
      'flaky: vitest:packages/logger/src/logger-factory.spec.ts:unhandled exception - Cannot find module dev/bunyan-format.js (thread-stream worker)',
    );
    expect(result).toEqual({
      shape: 'precise',
      kind: 'vitest',
      browser: null,
      specPath: 'packages/logger/src/logger-factory.spec.ts',
      testTitle:
        'unhandled exception - Cannot find module dev/bunyan-format.js (thread-stream worker)',
    });
  });

  it('a real title with no browser segment at all still parses as precise, with browser: null', () => {
    const result = parse(
      'flaky: playwright:playwright/20-basic-features/comments.spec.ts:Successfully add comments',
    );
    expect(result).toEqual({
      shape: 'precise',
      kind: 'playwright',
      browser: null,
      specPath: 'playwright/20-basic-features/comments.spec.ts',
      testTitle: 'Successfully add comments',
    });
  });
});

describe('identity.parse — the other two shapes (constructed; no real example found)', () => {
  it('a bare "playwright:{BROWSER}" key is the job-level fallback shape, with no guessed spec path', () => {
    const result = parse(CONSTRUCTED.playwrightJobLevel);
    expect(result).toEqual({
      shape: 'playwright-job-level',
      kind: 'playwright',
      browser: 'chromium',
      specPath: null,
      testTitle: null,
    });
  });

  it('a "vitest:" key with no source-file extension anywhere is malformed', () => {
    const result = parse(CONSTRUCTED.malformedVitest);
    expect(result).toEqual({
      shape: 'malformed',
      kind: 'vitest',
      browser: null,
      specPath: null,
      testTitle: null,
    });
  });

  it('a title with no colon at all is malformed with kind: null', () => {
    expect(parse('flaky: not-a-key-at-all')).toEqual({
      shape: 'malformed',
      kind: null,
      browser: null,
      specPath: null,
      testTitle: null,
    });
  });

  it('a bare identity key without the "flaky: " prefix is still parsed (the prefix is stripped only when present)', () => {
    expect(parse('vitest:src/foo.spec.ts:some test')).toEqual({
      shape: 'precise',
      kind: 'vitest',
      browser: null,
      specPath: 'src/foo.spec.ts',
      testTitle: 'some test',
    });
  });
});
