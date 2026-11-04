import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  extractFailBlocks,
  extractPlaywrightAnnotations,
  extractSummary,
  isSharedSetupHookBlock,
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
/** Real Playwright shard with one annotation and `0 failed / 1 flaky`. */
const PLAYWRIGHT_11903 = readFixture('11903-playwright-flaky-excerpt.txt');
/** Real Playwright shard whose summary is echoed again under `##[notice]`. */
const PLAYWRIGHT_11914 = readFixture('11914-playwright-flaky-excerpt.txt');
/** Constructed: a shard that ended `1 failed / 0 flaky`. */
const PLAYWRIGHT_ONE_FAILED = readFixture(
  'constructed-playwright-1-failed-0-flaky-excerpt.txt',
);

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

describe('job-log.extractPlaywrightAnnotations', () => {
  it('reads file and title out of a real mid-line ::error annotation', () => {
    const annotations = extractPlaywrightAnnotations(PLAYWRIGHT_11903);

    expect(annotations).toEqual([
      {
        file: 'apps/app/playwright/20-basic-features/inline-comment.spec.ts',
        title:
          '[chromium] › playwright/20-basic-features/inline-comment.spec.ts:4758:3 › Inline comment - visual refresh: mockup cross-check captures › Capture popover states 5 (normal) and 6 (edit mode) in DARK mode (Req 4.4)',
      },
    ]);
  });

  it('returns an empty list when the log carries no annotation', () => {
    expect(extractPlaywrightAnnotations(PLAYWRIGHT_11914)).toEqual([]);
  });

  it('reports an annotation with no title= as title null instead of dropping it', () => {
    // Tier 2's third fallback case ("a file but no test to name") only
    // exists if this shape survives extraction.
    const annotations = extractPlaywrightAnnotations(
      '2026-09-14T09:41:02.5Z ::error file=apps/app/playwright/60-home/home.spec.ts,line=31,col=3::Error: page.goto: Timeout',
    );

    expect(annotations).toEqual([
      { file: 'apps/app/playwright/60-home/home.spec.ts', title: null },
    ]);
  });

  it('keeps a repeated annotation as two entries, in the order observed', () => {
    // The procedure's tier-1 rule counts *distinct* annotations, so it needs
    // to see the repeats rather than be handed a deduplicated list.
    const line =
      '::error file=apps/app/playwright/a.spec.ts,title=[chromium] › a › one,line=3,col=1::boom';
    const other =
      '::error file=apps/app/playwright/b.spec.ts,title=[chromium] › b › two,line=9,col=1::boom';

    const annotations = extractPlaywrightAnnotations(
      [line, other, line].join('\n'),
    );

    expect(annotations.map((a) => a.file)).toEqual([
      'apps/app/playwright/a.spec.ts',
      'apps/app/playwright/b.spec.ts',
      'apps/app/playwright/a.spec.ts',
    ]);
  });

  it('keeps two annotations printed on the same line, in the order printed', () => {
    // A real annotation is printed mid-line with its message trailing after
    // `::` (#11903), so two of them can share a line.
    const annotations = extractPlaywrightAnnotations(
      '::error file=apps/app/playwright/a.spec.ts,title=[chromium] › a › one,line=3,col=1::boom ::error file=apps/app/playwright/b.spec.ts,title=[chromium] › b › two,line=9,col=1::bang',
    );

    expect(annotations).toEqual([
      { file: 'apps/app/playwright/a.spec.ts', title: '[chromium] › a › one' },
      { file: 'apps/app/playwright/b.spec.ts', title: '[chromium] › b › two' },
    ]);
  });

  it('keeps a comma inside the title instead of cutting the title there', () => {
    const annotations = extractPlaywrightAnnotations(
      '::error file=apps/app/playwright/a.spec.ts,title=[chromium] › a › writes one, then two,line=3,col=1::boom',
    );

    expect(annotations[0]?.title).toBe('[chromium] › a › writes one, then two');
  });
});

describe('job-log.extractSummary', () => {
  it('reads a real `0 failed / 1 flaky` shard summary, with the absent failed line as 0', () => {
    expect(extractSummary(PLAYWRIGHT_11903)).toEqual({
      failed: 0,
      flaky: 1,
      passed: 106,
      skipped: 0,
    });
  });

  it('reads a `1 failed / 0 flaky` shard summary', () => {
    expect(extractSummary(PLAYWRIGHT_ONE_FAILED)).toEqual({
      failed: 1,
      flaky: 0,
      passed: 105,
      skipped: 0,
    });
  });

  it('does not add up a count line the runner echoed a second time under ##[notice]', () => {
    expect(extractSummary(PLAYWRIGHT_11914)).toEqual({
      failed: 0,
      flaky: 1,
      passed: 106,
      skipped: 0,
    });
  });

  it('returns null — not zeros — when the log carries no count line at all', () => {
    expect(extractSummary(REPRO_11849)).toBeNull();
  });

  it('does not read vitest’s own `Test Files` / `Tests` totals as a shard summary', () => {
    // The real fixture ends with ` Test Files  1 failed | 309 passed (310)`
    // and ` Tests  5 failed | 4151 passed (4156)`; reading either as the
    // Playwright summary would make the tier-1 count test fire on a vitest
    // job.
    expect(CI_APP_TEST).toContain('1 failed');
    expect(extractSummary(CI_APP_TEST)).toBeNull();
  });

  it('reads a summary that carries exactly one of the four count lines', () => {
    expect(extractSummary('2026-09-14T09:41:02.5Z   2 skipped')).toEqual({
      failed: 0,
      flaky: 0,
      passed: 0,
      skipped: 2,
    });
  });
});
