import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  extractFailBlocks,
  extractPlaywrightRuns,
  isSharedSetupHookBlock,
  parsePlaywrightTestLine,
} from './job-log.ts';

const readFixture = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../fixtures/job-logs/${name}`, import.meta.url)),
    'utf8',
  );

/** Real `ci-app-test` job log: true ESC bytes, timestamps, 5 vitest failures. */
const CI_APP_TEST = readFixture('ci-app-test-100952911197-excerpt.txt');
/** Real `### Repro result` excerpt: literal `^[` caret notation, no summary. */
const REPRO_11849 = readFixture('11849-repro-result-log-excerpt.txt');
/** Real shared setup-hook timeout (issue #11752): file-level FAIL lines. */
const SETUP_HOOK_11752 = readFixture('11752-setup-hook-timeout-excerpt.txt');
/** Real Playwright shard: `1 flaky` with no test line under it. */
const PLAYWRIGHT_11903 = readFixture('11903-playwright-flaky-excerpt.txt');
/** Real Playwright shard whose summary is echoed again under `##[notice]`. */
const PLAYWRIGHT_11914 = readFixture('11914-playwright-flaky-excerpt.txt');
/** Constructed: a shard that ended `1 failed / 0 flaky`. */
const PLAYWRIGHT_ONE_FAILED = readFixture(
  'constructed-playwright-1-failed-0-flaky-excerpt.txt',
);
/**
 * Real firefox job: one flaky test reported by `##[error]` annotations only,
 * and two Playwright runs (normal, then guest-mode), each summary echoed again
 * under `##[notice]`.
 */
const PLAYWRIGHT_TWO_RUNS = readFixture(
  '43419616882-playwright-flaky-two-runs-excerpt.txt',
);
/** Real firefox job whose end-of-run list names two flaky tests. */
const PLAYWRIGHT_TWO_FLAKY = readFixture(
  '39935584265-playwright-two-flaky-excerpt.txt',
);
/** Real chromium job: one test failed every attempt, plus `1 did not run`. */
const PLAYWRIGHT_FAILED_ALL_ATTEMPTS = readFixture(
  '41984122671-playwright-failed-all-attempts-excerpt.txt',
);
/** Constructed: `2 flaky` heading over a single test line. */
const PLAYWRIGHT_COUNT_MISMATCH = readFixture(
  'constructed-playwright-flaky-count-mismatch-excerpt.txt',
);
/** Constructed: a list line that lacks its `path:line:col` position. */
const PLAYWRIGHT_ENTRY_WITHOUT_POSITION = readFixture(
  'constructed-playwright-list-entry-without-position-excerpt.txt',
);

const CREATE_PAGE_BUTTON_TEST = {
  project: 'firefox',
  specPath: 'playwright/20-basic-features/create-page-button.spec.ts',
  testTitle: 'Create page button dropdown menu > open and create today page',
};
const INLINE_COMMENT_REPLY_TITLE =
  'Inline comment - hover/click/tap on a saved body highlight opens a preview popover with simple reply (Req 2.1-2.5) > Requirement 2.3: submitting a reply from the popover posts it, and it appears nested under the origin item in the bottom list';
const EMPTY_LIST = { kind: 'read', tests: [] };

const SPEC_PATH_11849 =
  'src/client/components/Admin/Common/AdminCodeEditor.spec.tsx';
const SPEC_PATH_BULK_EXPORT =
  'src/features/page-bulk-export/server/service/page-bulk-export-job-cron/steps/export-pages-to-fs-async.spec.ts';

describe('job-log.extractFailBlocks', () => {
  it('reads project, spec path and the full suite-and-test title from a real ESC-coloured, timestamped log', () => {
    const blocks = extractFailBlocks(CI_APP_TEST);

    expect(blocks).toHaveLength(5);
    expect(blocks[0]).toMatchObject({
      project: 'app-unit',
      specPath: SPEC_PATH_BULK_EXPORT,
      testTitle:
        'export-pages-to-fs-async: getPageWritable > PDF format smoke test (Requirements 5.1, 2.1) > links the shared stylesheet and wraps content in .wiki, writing the CSS once per job',
      sharedSetupHook: false,
    });
  });

  it('ignores `FAIL ` lines that are not a vitest failure block', () => {
    // The same real log carries three of them, printed by the i18n-audit
    // tool's own stdout/stderr (`FAIL unused-key count 80 exceeds baseline
    // 10`), which the procedure's `grep 'FAIL '` could not tell apart.
    const specPaths = extractFailBlocks(CI_APP_TEST).map(
      (block) => block.specPath,
    );

    expect(specPaths.every((path) => path === SPEC_PATH_BULK_EXPORT)).toBe(
      true,
    );
    expect(specPaths.some((path) => path.includes('unused-key'))).toBe(false);
  });

  it('reads a log whose control sequences are literal `^[` caret text, not ESC bytes', () => {
    // Real shape: an excerpt pasted into an issue comment by `flaky-repro`
    // carries no 0x1b byte at all (see the fixture's .meta.md).
    expect(REPRO_11849).not.toContain('\x1b');

    const blocks = extractFailBlocks(REPRO_11849);

    expect(blocks).toHaveLength(6);
    expect(blocks[0]).toMatchObject({
      project: 'app-components',
      specPath: SPEC_PATH_11849,
      testTitle:
        'AdminCodeEditor > theme following > applies the dark theme when in dark mode',
    });
  });

  it('gives a file-level FAIL line a null test title instead of inventing one', () => {
    const blocks = extractFailBlocks(SETUP_HOOK_11752);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({
      project: 'app-integration',
      specPath: 'src/server/routes/apiv3/g2g-transfer-preflight.integ.ts',
      testTitle: null,
    });
  });

  it('marks only the block whose own frame resolves under test/setup/ as a shared setup hook', () => {
    const blocks = extractFailBlocks(SETUP_HOOK_11752);

    // The real log lists the three affected spec files first and prints the
    // hook's error and frame once, under the last of them — so the fact is
    // true of that block alone. Folding the three into one identity is the
    // procedure's judgment, not this module's.
    expect(blocks.map((block) => block.sharedSetupHook)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('keeps the error and stack lines of a block in its own excerpt, and not the next block’s', () => {
    const blocks = extractFailBlocks(CI_APP_TEST);

    expect(blocks[0]?.excerpt).toContain('MissingSchemaError');
    expect(blocks[0]?.excerpt).toContain(
      'export-pages-to-fs-async.spec.ts:134',
    );
    expect(blocks[0]?.excerpt).not.toContain(
      'export-pages-to-fs-async.spec.ts:168',
    );
    expect(blocks[0]?.excerpt).not.toContain('MD format smoke test');
  });

  it('runs the last block to the end of the text rather than dropping it', () => {
    const oneBlock = [
      '2026-09-04T07:59:07.2157417Z  FAIL   app-unit  src/a/one.spec.ts > suite > only case',
      '2026-09-04T07:59:07.2158623Z AssertionError: expected 1 to be 2',
      '2026-09-04T07:59:07.2159733Z  ❯ src/a/one.spec.ts:12:3',
    ].join('\n');

    const blocks = extractFailBlocks(oneBlock);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.specPath).toBe('src/a/one.spec.ts');
    expect(blocks[0]?.excerpt).toContain('AssertionError: expected 1 to be 2');
    expect(blocks[0]?.excerpt).toContain('src/a/one.spec.ts:12:3');
  });

  it('returns an empty list for a log with no failure block', () => {
    expect(extractFailBlocks(PLAYWRIGHT_11903)).toEqual([]);
  });

  it('reports a null project when the FAIL line carries no project tag', () => {
    // vitest prints the tag only when the run has more than one project.
    const blocks = extractFailBlocks(
      'FAIL src/a/one.spec.ts > suite > only case',
    );

    expect(blocks[0]).toMatchObject({
      project: null,
      specPath: 'src/a/one.spec.ts',
      testTitle: 'suite > only case',
    });
  });

  it('does not clip a long block: a frame far below the FAIL line still counts', () => {
    // The excerpt's tail is where the frames are, so a length limit that cut
    // a real block would hide both the test/setup/ frame and any denylist
    // string sitting under a long code frame.
    const padding = Array.from(
      { length: 60 },
      (_unused, index) => `    | ${index} some source line`,
    );
    const block = [
      ' FAIL   app-integration  src/a/one.integ.ts',
      'Error: Hook timed out in 20000ms.',
      ...padding,
      ' ❯ test/setup/migrate-mongo.ts:52:1',
    ].join('\n');

    expect(extractFailBlocks(block)[0]).toMatchObject({
      sharedSetupHook: true,
    });
  });
});

describe('job-log.isSharedSetupHookBlock', () => {
  it('is true for a frame resolving under test/setup/', () => {
    expect(
      isSharedSetupHookBlock(
        'Error: Hook timed out in 20000ms.\n ❯ test/setup/migrate-mongo.ts:52:1',
      ),
    ).toBe(true);
  });

  it('is false for a hook registered in the spec file itself', () => {
    // The `getInstance()` case the procedure calls out: the helper lives
    // under test/setup/, but the frame names the spec file.
    expect(
      isSharedSetupHookBlock(
        'Error: Hook timed out in 10000ms.\n ❯ src/server/service/user-group.integ.ts:60:3',
      ),
    ).toBe(false);
  });
});

describe('job-log.extractPlaywrightRuns', () => {
  it('reads the flaky test from the end-of-run list when the log carries only `##[error]` annotations', () => {
    expect(PLAYWRIGHT_TWO_RUNS).not.toContain('::error ');

    const runs = extractPlaywrightRuns(PLAYWRIGHT_TWO_RUNS);

    expect(runs[0]?.flaky).toEqual({
      kind: 'read',
      tests: [CREATE_PAGE_BUTTON_TEST],
    });
  });

  it('drops the `##[notice]` echo of a summary as a whole, including its untimestamped continuation lines', () => {
    const runs = extractPlaywrightRuns(PLAYWRIGHT_TWO_RUNS);

    expect(runs).toHaveLength(2);
    expect(runs.some((run) => run.excerpt.includes('##[notice]'))).toBe(false);
  });

  it('returns the normal run and the guest-mode run of one job as separate runs, without mixing their counts', () => {
    const runs = extractPlaywrightRuns(PLAYWRIGHT_TWO_RUNS);

    expect(runs.map((run) => run.counts)).toEqual([
      { failed: 0, flaky: 1, passed: 119, skipped: 0 },
      { failed: 0, flaky: 0, passed: 3, skipped: 0 },
    ]);
    expect(runs[1]?.flaky).toEqual(EMPTY_LIST);
    expect(runs[1]?.failed).toEqual(EMPTY_LIST);
  });

  it('returns the lines read as each run’s summary as its excerpt, timestamps kept, in printed order', () => {
    const runs = extractPlaywrightRuns(PLAYWRIGHT_TWO_RUNS);

    expect(runs.map((run) => run.excerpt)).toEqual([
      [
        '2026-11-13T11:57:10.1200900Z   1 flaky',
        '2026-11-13T11:57:10.1201655Z     [firefox] › playwright/20-basic-features/create-page-button.spec.ts:23:3 › Create page button dropdown menu › open and create today page ',
        '2026-11-13T11:57:10.1202212Z   119 passed (5.0m)',
      ].join('\n'),
      '2026-11-13T11:57:24.3041969Z   3 passed (12.7s)',
    ]);
  });

  it('returns every test of a list that names two flaky tests', () => {
    const runs = extractPlaywrightRuns(PLAYWRIGHT_TWO_FLAKY);

    expect(runs[0]?.flaky).toEqual({
      kind: 'read',
      tests: [
        CREATE_PAGE_BUTTON_TEST,
        {
          project: 'firefox',
          specPath: 'playwright/20-basic-features/inline-comment.spec.ts',
          testTitle:
            'Inline comment - hover-to-popover transit and popover-lock timing (Req 15.7-15.9); resolve from the popover and click-path regression (Req 15.10, 4.6) > Req 15.1, 15.4: clicking the highlight still opens the popover immediately, with no visible delay, and it stays open with no further interaction',
        },
      ],
    });
  });

  it('returns a test that failed every attempt in the failed list, not the flaky one, and reads past `did not run`', () => {
    const runs = extractPlaywrightRuns(PLAYWRIGHT_FAILED_ALL_ATTEMPTS);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.counts).toEqual({
      failed: 1,
      flaky: 0,
      passed: 118,
      skipped: 0,
    });
    expect(runs[0]?.failed).toEqual({
      kind: 'read',
      tests: [
        {
          project: 'chromium',
          specPath: 'playwright/20-basic-features/inline-comment.spec.ts',
          testTitle: INLINE_COMMENT_REPLY_TITLE,
        },
      ],
    });
    expect(runs[0]?.flaky).toEqual(EMPTY_LIST);
  });

  it('reports a list whose heading count differs from its number of test lines as unreadable', () => {
    const runs = extractPlaywrightRuns(PLAYWRIGHT_COUNT_MISMATCH);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.flaky).toEqual({
      kind: 'unreadable',
      reason: 'count-mismatch',
    });
  });

  it('reports a list with a test line lacking its position as a malformed entry, not a count mismatch', () => {
    const runs = extractPlaywrightRuns(PLAYWRIGHT_ENTRY_WITHOUT_POSITION);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.flaky).toEqual({
      kind: 'unreadable',
      reason: 'malformed-entry',
    });
  });

  it('returns no run — not a run of zeros — for a vitest log, whose own totals are not a Playwright summary', () => {
    expect(CI_APP_TEST).toContain('1 failed');

    expect(extractPlaywrightRuns(CI_APP_TEST)).toEqual([]);
  });

  it('reads the flaky test of a log with no timestamps at all', () => {
    const runs = extractPlaywrightRuns(PLAYWRIGHT_11914);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.flaky).toEqual({
      kind: 'read',
      tests: [
        {
          project: 'chromium',
          specPath: 'playwright/20-basic-features/inline-comment.spec.ts',
          testTitle: INLINE_COMMENT_REPLY_TITLE,
        },
      ],
    });
  });

  it('reports `1 flaky` with no test line under it as a count mismatch', () => {
    const runs = extractPlaywrightRuns(PLAYWRIGHT_11903);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.counts).toEqual({
      failed: 0,
      flaky: 1,
      passed: 106,
      skipped: 0,
    });
    expect(runs[0]?.flaky).toEqual({
      kind: 'unreadable',
      reason: 'count-mismatch',
    });
  });

  it('returns the test of a `1 failed / 0 flaky` run in the failed list', () => {
    const runs = extractPlaywrightRuns(PLAYWRIGHT_ONE_FAILED);

    expect(runs[0]?.failed).toEqual({
      kind: 'read',
      tests: [
        {
          project: 'webkit',
          specPath: 'playwright/20-basic-features/comments.spec.ts',
          testTitle: 'Successfully add comments',
        },
      ],
    });
    expect(runs[0]?.flaky).toEqual(EMPTY_LIST);
  });

  it('leaves no trailing whitespace on a test title read from a list line that ends with a space', () => {
    const listLine = PLAYWRIGHT_TWO_RUNS.split('\n').find((line) =>
      line.includes('[firefox] › '),
    );
    expect(listLine?.endsWith(' ')).toBe(true);

    const runs = extractPlaywrightRuns(PLAYWRIGHT_TWO_RUNS);
    const flaky = runs[0]?.flaky;

    expect(flaky?.kind === 'read' && flaky.tests[0]?.testTitle).toBe(
      'Create page button dropdown menu > open and create today page',
    );
  });

  it('does not read a count-and-word line that is not a whole Playwright count line as a run', () => {
    const log = [
      '2026-09-14T09:41:02.5Z   2 failed migrations were rolled back',
      '2026-09-14T09:41:02.6Z   3 passed checks, 1 warning',
    ].join('\n');

    expect(extractPlaywrightRuns(log)).toEqual([]);
  });

  it('reads a `passed` count line whatever unit its duration is printed in', () => {
    for (const duration of [
      '(0ms)',
      '(850ms)',
      '(14.7s)',
      '(5.3m)',
      '(1.2h)',
    ]) {
      expect(
        extractPlaywrightRuns(`  3 passed ${duration}`)[0]?.counts.passed,
      ).toBe(3);
    }
  });

  it('assigns the tests listed under `interrupted` to neither the failed nor the flaky list', () => {
    const log = [
      '  1 interrupted',
      '    [chromium] › playwright/a.spec.ts:1:1 › stopped case ',
      '  1 flaky',
      '    [chromium] › playwright/b.spec.ts:2:2 › flaky case ',
      '  3 passed (1.0m)',
    ].join('\n');

    const runs = extractPlaywrightRuns(log);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.counts).toEqual({
      failed: 0,
      flaky: 1,
      passed: 3,
      skipped: 0,
    });
    expect(runs[0]?.flaky).toEqual({
      kind: 'read',
      tests: [
        {
          project: 'chromium',
          specPath: 'playwright/b.spec.ts',
          testTitle: 'flaky case',
        },
      ],
    });
    expect(runs[0]?.failed).toEqual(EMPTY_LIST);
  });

  it('closes a run that ends the text with no line after it', () => {
    expect(extractPlaywrightRuns('2026-09-14T09:41:02.5Z   2 skipped')).toEqual(
      [
        {
          counts: { failed: 0, flaky: 0, passed: 0, skipped: 2 },
          flaky: EMPTY_LIST,
          failed: EMPTY_LIST,
          excerpt: '2026-09-14T09:41:02.5Z   2 skipped',
        },
      ],
    );
  });
});

describe('job-log.parsePlaywrightTestLine', () => {
  it('splits project, spec path and the ` › `-separated title path, joining the titles with ` > `', () => {
    expect(
      parsePlaywrightTestLine(
        '    [firefox/guest-mode] › playwright/30-search/search.spec.ts:12:5 › Search › nested group › finds a page ',
      ),
    ).toEqual({
      project: 'firefox/guest-mode',
      specPath: 'playwright/30-search/search.spec.ts',
      testTitle: 'Search > nested group > finds a page',
    });
  });

  it('strips the ` ─…` padding Playwright adds to a list line of 98 columns or fewer', () => {
    expect(
      parsePlaywrightTestLine(
        `    [users] › playwright/users.setup.ts:54:1 › provision filter test users ${'─'.repeat(25)}`,
      ),
    ).toEqual({
      project: 'users',
      specPath: 'playwright/users.setup.ts',
      testTitle: 'provision filter test users',
    });
  });

  it('leaves a title that has no padding untouched', () => {
    expect(
      parsePlaywrightTestLine(
        '  [chromium] › playwright/a.spec.ts:1:1 › group › opens the popover',
      )?.testTitle,
    ).toBe('group > opens the popover');
  });

  it('keeps a `─` that ends the title itself, whether or not `─` padding follows its space', () => {
    const line = '    [chromium] › playwright/a.spec.ts:1:1 › draws a ─';

    expect(
      parsePlaywrightTestLine(`${line} ${'─'.repeat(10)}`)?.testTitle,
    ).toBe('draws a ─');
    expect(parsePlaywrightTestLine(`${line} `)?.testTitle).toBe('draws a ─');
  });

  it('keeps a `:` inside the test title', () => {
    expect(
      parsePlaywrightTestLine(
        '[chromium] › playwright/a.spec.ts:7:3 › Req 15.1: opens the popover',
      )?.testTitle,
    ).toBe('Req 15.1: opens the popover');
  });

  it('returns null for a line without the `path:line:col` position', () => {
    expect(
      parsePlaywrightTestLine(
        '[firefox] › playwright/a.spec.ts › Create page button dropdown menu › open',
      ),
    ).toBeNull();
  });

  it('returns null for a line with no test title after the position', () => {
    expect(
      parsePlaywrightTestLine('[firefox] › playwright/a.spec.ts:23:3 '),
    ).toBeNull();
  });

  it('returns null for a numbered failure heading, which is not a list line', () => {
    expect(
      parsePlaywrightTestLine(
        '##[error]  1) [firefox] › playwright/a.spec.ts:23:3 › group › case ',
      ),
    ).toBeNull();
  });
});
