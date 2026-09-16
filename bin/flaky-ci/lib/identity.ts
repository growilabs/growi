/**
 * Decomposing a flaky-tracking issue title into its identity key parts.
 *
 * `detect-flaky-ci` titles every tracking issue `flaky: {IDENTITY_KEY}`,
 * where `IDENTITY_KEY` is one of three shapes `investigate-flaky-test/
 * SKILL.md` Step 1 already documents in prose:
 *
 * - `vitest:{SPEC_PATH}:{TEST_TITLE}` — precise.
 * - `playwright:{BROWSER}:{SPEC_PATH}:{TEST_TITLE}` — precise.
 * - `playwright:{BROWSER}` — a job-level fallback: `detect-flaky-ci` could
 *   not isolate which spec was flaky from the CI log alone.
 *
 * A `vitest:` key that does not match the precise shape is malformed — no
 * `detect-flaky-ci` path produces one, so this is a precondition to surface,
 * not a case to guess through.
 *
 * This module only decomposes; it does not decide anything. Which of the
 * three shapes leads to which next step (read the linked run's Playwright
 * report before Step 2, stop and report a precondition failure, proceed to
 * reproduction) is a judgment left in `investigate-flaky-test/SKILL.md`, not
 * moved here (research.md §"14 候補の現在位置" on candidate #8: "解析は
 * 機械的、戻り値の3分類後の扱いは判断" — the parse is mechanical, what
 * happens after is judgment).
 *
 * `{SPEC_PATH}` is anchored on the *shortest* following segment ending in a
 * source-file extension immediately followed by `:` — not on splitting at
 * the first/last `:`, which would get both the browser segment and a title
 * containing `:` wrong (a real title has two: "Inline comment - visual
 * refresh: mockup cross-check captures > Capture popover states 5 (normal)
 * and 6 (edit mode) in DARK mode"). The extension list is wider than
 * `spec`/`integ` because one real identity's `{SPEC_PATH}` is a plain `.ts`
 * setup file (`vitest:test/setup/migrate-mongo.ts:beforeAll migration setup
 * hook timeout …`, issue #11752), and a test title can itself name a `.js`
 * file (`… Cannot find module dev/bunyan-format.js (thread-stream worker)`,
 * issue #11818) without being mistaken for the boundary, because the
 * shortest match wins and that mention is never followed by `:`.
 */

const FLAKY_TITLE_PREFIX = 'flaky: ';

/**
 * `{SPEC_PATH}:{TEST_TITLE}` with an optional leading `{BROWSER}:` segment.
 * Group 1 (with its trailing `:`) is the browser segment when present; group
 * 2 is `{SPEC_PATH}`; group 3 is `{TEST_TITLE}`, verbatim, including any
 * further `:` it contains.
 */
const PRECISE_WITH_OPTIONAL_BROWSER = /^([^:]+:)?(.+?\.(?:tsx?|jsx?)):(.*)$/;

/** The same shape, without the optional browser segment (`vitest:` never has one). */
const PRECISE_NO_BROWSER = /^(.+?\.(?:tsx?|jsx?)):(.*)$/;

export type ParsedIdentity =
  | {
      readonly shape: 'precise';
      readonly kind: 'vitest' | 'playwright';
      readonly browser: string | null;
      readonly specPath: string;
      readonly testTitle: string;
    }
  | {
      readonly shape: 'playwright-job-level';
      readonly kind: 'playwright';
      readonly browser: string;
      readonly specPath: null;
      readonly testTitle: null;
    }
  | {
      readonly shape: 'malformed';
      readonly kind: string | null;
      readonly browser: null;
      readonly specPath: null;
      readonly testTitle: null;
    };

const malformed = (kind: string | null): ParsedIdentity => ({
  shape: 'malformed',
  kind,
  browser: null,
  specPath: null,
  testTitle: null,
});

/**
 * Decomposes one issue title (with or without the `flaky: ` prefix — the
 * prefix is stripped when present, and the remainder is treated as the
 * identity key otherwise) into kind / browser / spec path / test title, and
 * which of the three shapes it is.
 */
export const parse = (title: string): ParsedIdentity => {
  const key = title.startsWith(FLAKY_TITLE_PREFIX)
    ? title.slice(FLAKY_TITLE_PREFIX.length)
    : title;

  const firstColon = key.indexOf(':');
  if (firstColon === -1) {
    return malformed(null);
  }
  const kind = key.slice(0, firstColon);
  const remainder = key.slice(firstColon + 1);

  if (kind === 'vitest') {
    const match = remainder.match(PRECISE_NO_BROWSER);
    if (match == null) {
      return malformed('vitest');
    }
    const [, specPath, testTitle] = match;
    return {
      shape: 'precise',
      kind: 'vitest',
      browser: null,
      specPath: specPath as string,
      testTitle: testTitle as string,
    };
  }

  if (kind === 'playwright') {
    const match = remainder.match(PRECISE_WITH_OPTIONAL_BROWSER);
    if (match == null) {
      // No spec path could be found at all: the job-level fallback key
      // `playwright:{BROWSER}` — the whole remainder is the browser,
      // verbatim, and no spec path is guessed.
      return {
        shape: 'playwright-job-level',
        kind: 'playwright',
        browser: remainder,
        specPath: null,
        testTitle: null,
      };
    }
    const [, browserSegment, specPath, testTitle] = match;
    return {
      shape: 'precise',
      kind: 'playwright',
      browser: browserSegment == null ? null : browserSegment.slice(0, -1),
      specPath: specPath as string,
      testTitle: testTitle as string,
    };
  }

  return malformed(kind);
};
