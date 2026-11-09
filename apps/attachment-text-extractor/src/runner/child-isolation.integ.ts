import { readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildLargeForTimeoutXlsx,
  buildLargeImagesDocx,
  buildLargeImagesPptx,
  buildLargePivotCacheXlsx,
  buildLongPagePdf,
  buildOneSheetAtCellLimitXlsx,
  buildOneSheetOverCellLimitXlsx,
  buildOverCellLimitXlsx,
  buildTextPdf,
  buildTwelveImagesDocx,
  buildXlsxCells,
  MAX_XLSX_CELLS,
} from '../../test/fixtures';
import type { FailureKind } from '../contract';
import {
  type ConversionRunner,
  type ConversionRunnerOptions,
  createConversionRunner,
  type RunInput,
  type RunOutcome,
} from './conversion-runner';
import {
  childPids,
  hasEnded,
  killStrayChildren,
  runnerOptions,
  SERVICE_TOKEN_NAME,
  STAND_IN_CHILD,
  standInInput,
  startHost,
  waitUntil,
  within,
} from './spec-support';
import {
  buildPptxBomb,
  buildXlsxBomb,
  type DeclaredSize,
} from './spec-support/zip-bombs';

// The same guarantees as conversion-runner.integ.ts, end to end: real files,
// the real child entry, the production limits (Python test_child_isolation.py).
// The long PDF page converts for about a second of synchronous PDFium work
// (research.md 14.5), so it is the input a short deadline stops mid-way; with
// MAX_CHILD_RSS_MB raised it is not stopped by the RSS limit first.

const MIB = 1024 * 1024;
const MAX_CHILD_RSS_MB = 320;
const OWN_TMP_PREFIX = 'ate-runner-spec-';
const LONG_PAGE_ROOM: Partial<ConversionRunnerOptions> = {
  maxChildRssMb: 2000,
};

const once = <T>(build: () => T): (() => T) => {
  let built: { value: T } | undefined;
  return () => {
    built ??= { value: build() };
    return built.value;
  };
};

const longPagePdf = once(buildLongPagePdf);
const largeImagesDocx = once(buildLargeImagesDocx);
const csv20Mib = once(() => Buffer.from('a,b,c,d\n'.repeat((20 * MIB) / 8)));

const runnerWith = (
  overrides: Partial<ConversionRunnerOptions> = {},
): ConversionRunner => createConversionRunner(runnerOptions(overrides));

/** The production caps on CSV / HTML lifted to any upload, so the child's own limits act. */
const withoutInputSizeCaps = (): Partial<ConversionRunnerOptions> => ({
  limits: {
    ...runnerOptions().limits,
    maxCsvBytes: 50 * MIB,
    maxHtmlBytes: 50 * MIB,
  },
});

const file = (bytes: Buffer, fileName: string): RunInput => ({
  bytes,
  fileName,
  mimeHint: null,
});

const run = (runner: ConversionRunner, input: RunInput): Promise<RunOutcome> =>
  within(runner.run(input, new AbortController().signal));

const failureOf = (outcome: RunOutcome): FailureKind | 'ok' =>
  outcome.kind === 'ok' ? 'ok' : outcome.failure;

const textOf = (outcome: RunOutcome): string =>
  outcome.kind === 'ok'
    ? outcome.pages.map((page) => page.content).join('\n')
    : '';

const expectNothingLeft = (): void => {
  expect(childPids()).toEqual([]);
};

/**
 * Entries that appeared in the temporary directory since `before` and stay
 * there: other test files' short-lived directories come and go, a leftover of
 * a killed child does not.
 */
const lastingNewTmpEntries = async (
  before: ReadonlySet<string>,
): Promise<string[]> => {
  const fresh = (): string[] =>
    readdirSync(tmpdir()).filter(
      (name) => !before.has(name) && !name.startsWith(OWN_TMP_PREFIX),
    );
  await waitUntil(() => fresh().length === 0, 2_000, 50);
  return fresh();
};

describe.skipIf(process.platform !== 'linux')(
  'real conversions in isolated children',
  { timeout: 120_000 },
  () => {
    afterEach(killStrayChildren);

    describe('the deadline (Req 3.4)', () => {
      it('stops a conversion at the deadline, reaps its child, and the next run succeeds', async () => {
        const short = runnerWith({ ...LONG_PAGE_ROOM, timeoutS: 0.4 });
        const normal = runnerWith();

        for (let i = 0; i < 3; i++) {
          expect(
            failureOf(await run(short, file(longPagePdf(), 'long.pdf'))),
          ).toBe('timeout');
          expectNothingLeft();

          const after = await run(
            normal,
            file(buildLargeForTimeoutXlsx(), 'big.xlsx'),
          );
          expect(failureOf(after)).toBe('ok');
          expect(textOf(after)).toContain('r13999c0');
          expectNothingLeft();
        }
      });

      it('leaves no temporary files after a conversion killed mid-way', async () => {
        const runner = runnerWith({ ...LONG_PAGE_ROOM, timeoutS: 0.4 });
        const idle = await run(
          runner,
          file(buildTextPdf(['idle']), 'idle.pdf'),
        );
        const before = new Set(readdirSync(tmpdir()));

        const killed = await run(runner, file(longPagePdf(), 'long.pdf'));

        expect(failureOf(killed)).toBe('timeout');
        // Clearly above a near-idle child: the conversion was under way when it was killed.
        expect(killed.childPeakRssMb).toBeGreaterThan(
          (idle.childPeakRssMb ?? Infinity) + 8,
        );
        expect(await lastingNewTmpEntries(before)).toEqual([]);
        expectNothingLeft();
      });

      it('gives the parent memory back after timeouts with a large input', async () => {
        // The stand-in holds the whole 44 MB input until it is killed.
        const runner = createConversionRunner(
          runnerOptions({ childEntry: STAND_IN_CHILD, timeoutS: 0.5 }),
        );
        const input = standInInput('hang', { totalBytes: 44 * MIB });
        expect(failureOf(await run(runner, input))).toBe('timeout');
        const before = process.memoryUsage().rss;

        for (let i = 0; i < 3; i++) {
          expect(failureOf(await run(runner, input))).toBe('timeout');
          expectNothingLeft();
        }

        // A copy kept per run would add 44 MB each time, 132 MB over three.
        expect((process.memoryUsage().rss - before) / MIB).toBeLessThan(66);
      });
    });

    describe('memory and CPU limits (Req 3.4)', () => {
      it('stops a real XLSX over a small RSS limit as memory_exceeded', async () => {
        // 128 MB sits between an idle child (about 65 MB) and this workbook's
        // peak (about 290 MB, research.md 20).
        const runner = runnerWith({ maxChildRssMb: 128 });

        const outcome = await run(
          runner,
          file(buildOneSheetAtCellLimitXlsx(), 'big.xlsx'),
        );

        expect(failureOf(outcome)).toBe('memory_exceeded');
        expect(outcome.childPeakRssMb).toBeGreaterThan(128);
        expectNothingLeft();
      });

      it('lets the kernel end a child over its CPU-time limit, classified as timeout', async () => {
        const runner = createConversionRunner(
          runnerOptions({ childEntry: STAND_IN_CHILD, timeoutS: 20 }),
        );
        const began = Date.now();

        const outcome = await run(runner, standInInput('cpu-overrun'));

        expect(failureOf(outcome)).toBe('timeout');
        // Ended by its 1 s CPU limit, long before the parent's 20 s deadline.
        expect(Date.now() - began).toBeLessThan(10_000);
        expectNothingLeft();
      });
    });

    describe('a crash stays inside its child (Req 3.10)', () => {
      it.each([
        'abort',
        'segfault',
      ])('answers crashed for a child that dies by %s while a concurrent conversion succeeds', async (crash) => {
        const converting = run(
          runnerWith(LONG_PAGE_ROOM),
          file(longPagePdf(), 'long.pdf'),
        );
        let convertingDone = false;
        const markDone = (): void => {
          convertingDone = true;
        };
        converting.then(markDone, markDone);
        const crashing = createConversionRunner(
          runnerOptions({ childEntry: STAND_IN_CHILD }),
        );

        const crashed = await run(crashing, standInInput(crash));
        const stillRunningAtCrash = !convertingDone;
        const converted = await converting;

        expect(failureOf(crashed)).toBe('crashed');
        expect(stillRunningAtCrash).toBe(true);
        expect(failureOf(converted)).toBe('ok');
        expect(textOf(converted)).toContain('a'.repeat(1000));
        expectNothingLeft();
      });
    });

    // Req 3.11 through the whole stack: a separate parent process runs the real
    // runner, whose child imports the real parent watch and then spins forever.
    describe('the parent goes away (Req 3.11)', () => {
      let markerDir: string | undefined;

      afterEach(async () => {
        if (markerDir !== undefined) {
          await rm(markerDir, { recursive: true, force: true });
          markerDir = undefined;
        }
      });

      it('ends a child stuck in synchronous code within 1 s of its parent being killed', async () => {
        markerDir = await mkdtemp(path.join(tmpdir(), OWN_TMP_PREFIX));
        const marker = path.join(markerDir, 'child.pid');
        const { host } = startHost(
          { entry: 'watched-busy', mode: 'spin', argument: marker },
          { env: { [SERVICE_TOKEN_NAME]: 'spec-token' } },
        );
        let childPid = 0;
        try {
          const watching = await waitUntil(
            () => {
              try {
                childPid = Number(readFileSync(marker, 'utf8'));
              } catch {
                // not written yet
              }
              return childPid > 0;
            },
            20_000,
            20,
          );
          expect(watching).toBe(true);
          expect(hasEnded(childPid)).toBe(false);

          host.kill('SIGKILL');
          const killedAt = Date.now();
          const ended = await waitUntil(() => hasEnded(childPid), 1_000, 2);

          expect(ended).toBe(true);
          expect(Date.now() - killedAt).toBeLessThan(1_000);
        } finally {
          host.kill('SIGKILL');
          if (childPid > 0 && !hasEnded(childPid)) {
            process.kill(childPid, 'SIGKILL');
          }
        }
      });
    });

    describe('the default limits let large legitimate files through (Req 11.2)', () => {
      // research.md 20.12: child_peak_rss_mb < 0.95 x MAX_CHILD_RSS_MB carries
      // over; Python's VmPeak < 0.8 x RLIMIT_AS does not (V8 sizes its
      // reservations to the limit). The peak is sampled, so it can only read low.
      it.each<[string, () => Buffer, string]>([
        ['a DOCX with large images', buildLargeImagesDocx, 'images.docx'],
        [
          'the 48 MB DOCX with twelve images',
          buildTwelveImagesDocx,
          'twelve.docx',
        ],
        ['a PPTX with large images', buildLargeImagesPptx, 'images.pptx'],
        [
          'five sheets at the cell limit',
          buildLargeForTimeoutXlsx,
          'five.xlsx',
        ],
        [
          'one sheet at the cell limit in 10 columns',
          () =>
            buildXlsxCells([
              { name: 'Data', rows: MAX_XLSX_CELLS / 10, cols: 10 },
            ]),
          'wide.xlsx',
        ],
        [
          'one sheet at the cell limit in 1 column',
          buildOneSheetAtCellLimitXlsx,
          'tall.xlsx',
        ],
        [
          'a workbook with a 150 MiB pivot cache',
          () =>
            buildLargePivotCacheXlsx([
              {
                name: 'Sheet1',
                rows: [
                  ['region', 'sales'],
                  ['east', 10],
                ],
              },
            ]),
          'pivot.xlsx',
        ],
      ])('converts %s under 95 % of the RSS limit', async (_case, build, fileName) => {
        const outcome = await run(runnerWith(), file(build(), fileName));

        expect(failureOf(outcome)).toBe('ok');
        expect(outcome.childPeakRssMb).toBeGreaterThan(0);
        expect(outcome.childPeakRssMb).toBeLessThan(0.95 * MAX_CHILD_RSS_MB);
        expectNothingLeft();
      });

      it.each<[string, () => Buffer]>([
        ['ten columns', buildOverCellLimitXlsx],
        ['one sheet', buildOneSheetOverCellLimitXlsx],
      ])('stops an XLSX one cell over the limit (%s) before its memory grows', async (_case, build) => {
        const outcome = await run(runnerWith(), file(build(), 'over.xlsx'));

        expect(failureOf(outcome)).toBe('limit_exceeded');
        // Reaching anydoc would push a sheet this size near 290 MB.
        expect(outcome.childPeakRssMb).toBeLessThan(0.4 * MAX_CHILD_RSS_MB);
        expectNothingLeft();
      });
    });

    describe('inputs the converters cannot bound are stopped by the child limits', () => {
      it('stops a 20 MiB CSV of small cells by its RSS, and the next run succeeds', async () => {
        const runner = runnerWith(withoutInputSizeCaps());

        const outcome = await run(runner, file(csv20Mib(), 'big.csv'));
        const after = await run(
          runner,
          file(Buffer.from('plain text after'), 'after.txt'),
        );

        expect(failureOf(outcome)).toBe('memory_exceeded');
        expect(textOf(after)).toBe('plain text after');
        expectNothingLeft();
      });

      // Python's html.parser blew up on these (memory_exceeded); htmlparser2 is
      // not expected to (research.md 18.7), so the case asks only that the run
      // stays inside its child: an answer or a 422-class refusal, never a crash,
      // and the next run unaffected.
      it.each<[string, () => Buffer]>([
        [
          'a tag of four million slashes',
          () => Buffer.from(`<a${'/'.repeat(4_000_000)}>`),
        ],
        [
          'an end tag with two million attributes',
          () => Buffer.from(`</a${' x'.repeat(2_000_000)}>`),
        ],
        [
          'a tag with two million attributes',
          () => Buffer.from(`<a ${'x '.repeat(2_000_000)}>`),
        ],
      ])('keeps HTML with %s inside its child', async (_case, build) => {
        const runner = runnerWith(withoutInputSizeCaps());

        const outcome = await run(runner, file(build(), 'pathological.html'));
        const after = await run(
          runner,
          file(Buffer.from('plain text after'), 'after.txt'),
        );

        expect([
          'ok',
          'memory_exceeded',
          'limit_exceeded',
          'result_too_large',
        ]).toContain(failureOf(outcome));
        expect(textOf(after)).toBe('plain text after');
        expectNothingLeft();
      });

      // Measured for Node in research.md 20.12.
      it.each<[string, FailureKind]>([
        ['big.csv', 'memory_exceeded'],
        ['big.html', 'result_too_large'],
      ])('stops a large DOCX sent as %s with %s', async (fileName, kind) => {
        const outcome = await run(
          runnerWith(withoutInputSizeCaps()),
          file(largeImagesDocx(), fileName),
        );

        expect(failureOf(outcome)).toBe(kind);
        expectNothingLeft();
      });

      it.each([
        'big.csv',
        'big.tsv',
        'big.html',
      ])('with the default caps never starts a child for a large %s', async (fileName) => {
        const runner = runnerWith();
        // The DOCX is over both caps; the 20 MiB CSV is over the CSV cap only.
        const inputs =
          fileName === 'big.html'
            ? [largeImagesDocx()]
            : [largeImagesDocx(), csv20Mib()];

        for (const bytes of inputs) {
          const outcome = await run(runner, file(bytes, fileName));

          expect(failureOf(outcome)).toBe('limit_exceeded');
          expect(outcome.childPeakRssMb).toBeNull();
        }
        expectNothingLeft();
      });

      it('stops a PDF page of four million characters by its RSS, and the next run succeeds', async () => {
        const runner = runnerWith();

        const outcome = await run(runner, file(longPagePdf(), 'long-page.pdf'));
        const after = await run(
          runner,
          file(buildTextPdf(['after the long page']), 'doc.pdf'),
        );

        expect(failureOf(outcome)).toBe('memory_exceeded');
        expect(textOf(after)).toBe('after the long page');
        expectNothingLeft();
      });
    });

    // research.md 22.7 (added in the 4.2 review): a part that inflates past
    // MAX_ARCHIVE_UNCOMPRESSED_MB must be refused without being inflated into
    // memory. A converter that inflated it first would hit the RSS limit and
    // answer memory_exceeded instead.
    describe('ZIP bombs (Req 3.7)', () => {
      const bombs: [string, (declared: DeclaredSize) => Buffer, string][] = [
        ['PPTX', buildPptxBomb, 'bomb.pptx'],
        ['XLSX', buildXlsxBomb, 'bomb.xlsx'],
      ];

      it.each(
        bombs,
      )('refuses a %s whose part declares more than 512 MiB as limit_exceeded with flat memory', async (_format, build, fileName) => {
        const outcome = await run(
          runnerWith(),
          file(build('honest'), fileName),
        );

        expect(failureOf(outcome)).toBe('limit_exceeded');
        expect(outcome.childPeakRssMb).toBeLessThan(0.4 * MAX_CHILD_RSS_MB);
        expectNothingLeft();
      });

      // The headers claim 4 KiB. A reader bounded by the declared size reports
      // malformed (archive-guard.spec.ts: lying sizes are never truncated
      // silently); one bounded by the archive limit reports limit_exceeded.
      it.each(
        bombs,
      )('refuses a %s whose part lies about its size without inflating it into memory', async (_format, build, fileName) => {
        const outcome = await run(runnerWith(), file(build('lying'), fileName));

        expect(['limit_exceeded', 'malformed']).toContain(failureOf(outcome));
        expect(outcome.childPeakRssMb).toBeLessThan(0.4 * MAX_CHILD_RSS_MB);
        expectNothingLeft();
      });
    });
  },
);
