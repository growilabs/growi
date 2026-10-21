/**
 * Integration tests for export-pages-to-fs-async (Tasks 5.1, 7.1).
 *
 * Observable contract verified here:
 *  - PDF format: output HTML file links the shared stylesheet via <link> (CSS
 *    is written once per job, not inlined into each page).
 *  - PDF format: output HTML file contains <div class="wiki"> wrapper.
 *  - MD format: output file is written as-is (no HTML rendering applied).
 *  - Error handling: when renderToHtml rejects, the Writable write callback
 *    receives the error (job is not silently completed). (Req 3.2)
 *  - Resume: exportPagesToFsAsync exports only snapshots after
 *    lastExportedPagePath when that field is set on the job. (Req 5.3)
 *  - Resume (no prior export): full scan when lastExportedPagePath is unset.
 *  - Snapshots are read in batches of pageBatchSize, continuing from the last
 *    path of the previous batch.
 *
 * Requirements: 3.2, 5.1, 5.2, 5.3
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Writable } from 'node:stream';
import { mock } from 'vitest-mock-extended';

import {
  PageBulkExportFormat,
  PageBulkExportJobStatus,
} from '~/features/page-bulk-export/interfaces/page-bulk-export';
import type {
  Prisma,
  pagebulkexportjobs,
  revisions,
} from '~/generated/prisma/client';

import type { IPageBulkExportJobCronService } from '..';
import * as RendererModule from '../markdown';
import {
  exportPagesToFsAsync,
  getPageWritable,
} from './export-pages-to-fs-async';

// The job's progress writes (lastExportedPagePath / status) and the snapshot
// reads go through prisma. Stub the client so this unit test needs no database.
const { findManySnapshots } = vi.hoisted(() => ({
  findManySnapshots: vi.fn(),
}));
vi.mock('~/utils/prisma', () => {
  return {
    prisma: {
      pagebulkexportjobs: {
        update: vi.fn(() => Promise.resolve({})),
      },
      pagebulkexportpagesnapshots: { findMany: findManySnapshots },
    },
  };
});

type PageBulkExportPageSnapshotWithRevision =
  Prisma.pagebulkexportpagesnapshotsGetPayload<{
    include: { revision: true };
  }>;

// ---------------------------------------------------------------------------
// getPageWritable resolves the exporting user once per job via
// `mongoose.model('User')` (User isn't registered in this unit-test process).
// None of the fixtures below embed an attachment image, so the returned user
// is never read.
// ---------------------------------------------------------------------------
vi.mock('mongoose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mongoose')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      model: (name: string, ...rest: unknown[]) =>
        name === 'User'
          ? { findById: vi.fn().mockResolvedValue(undefined) }
          : // biome-ignore lint/suspicious/noExplicitAny: forwarding to the real mongoose.model overload set
            (actual.default.model as any)(name, ...rest),
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal IPageBulkExportJobCronService mock whose getTmpOutputDir
 * returns tmpDir.
 */
function makeService(tmpDir: string): IPageBulkExportJobCronService {
  const svc = mock<IPageBulkExportJobCronService>();
  svc.getTmpOutputDir.mockReturnValue(tmpDir);
  return svc;
}

/**
 * Build a minimal page bulk export job for the given format.
 * lastExportedPagePath defaults to null (no prior export).
 */
function makeJob(
  format: string,
  lastExportedPagePath: string | null = null,
): pagebulkexportjobs {
  return mock<pagebulkexportjobs>({
    id: '000000000000000000000001',
    format,
    lastExportedPagePath,
    status: PageBulkExportJobStatus.exporting,
  });
}

/**
 * Build a minimal page snapshot mock with its revision included.
 */
function makePageSnapshot(
  pagePath: string,
  markdownBody: string,
): PageBulkExportPageSnapshotWithRevision {
  return mock<PageBulkExportPageSnapshotWithRevision>({
    path: pagePath,
    revision: mock<revisions>({ body: markdownBody }),
  });
}

/**
 * Write one page snapshot through a Writable and wait for the callback.
 * Resolves on success; rejects with the error passed to callback on failure.
 */
function writeOneChunk(
  writable: Writable,
  snapshot: PageBulkExportPageSnapshotWithRevision,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    writable.write(snapshot, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('export-pages-to-fs-async: getPageWritable', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-export-smoke-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  describe('PDF format smoke test (Requirements 5.1, 2.1)', () => {
    it('links the shared stylesheet and wraps content in .wiki, writing the CSS once per job', async () => {
      const job = makeJob(PageBulkExportFormat.pdf);
      const svc = makeService(tmpDir);
      const snapshot = makePageSnapshot(
        '/test/page',
        '# Hello\n\nSome **bold** text.',
      );

      const writable = await getPageWritable.call(svc, job);
      await writeOneChunk(writable, snapshot);

      // The output file for pdf format has .html extension
      const outputPath = path.join(tmpDir, 'test', 'page.html');
      expect(fs.existsSync(outputPath)).toBe(true);

      const content = fs.readFileSync(outputPath, 'utf8');

      // Links the shared stylesheet relatively — CSS is NOT inlined per page.
      expect(content).toMatch(
        /<link rel="stylesheet" href="[^"]*_bulk-export\.css">/,
      );
      expect(content).not.toContain('<style>');

      // Must have the .wiki wrapper — design.md § BulkExportStyleProvider
      expect(content).toContain('<div class="wiki">');
      expect(content).toContain('</div>');

      // The shared stylesheet is written once per job, with non-empty CSS.
      const cssPath = path.join(tmpDir, '_bulk-export.css');
      expect(fs.existsSync(cssPath)).toBe(true);
      expect(fs.readFileSync(cssPath, 'utf8').trim().length).toBeGreaterThan(0);
    }, 30_000); // allow time for dynamicImport on first run
  });

  // -------------------------------------------------------------------------
  describe('MD format smoke test (Requirement 5.2)', () => {
    it('writes raw Markdown (no HTML rendering) for md format', async () => {
      const job = makeJob(PageBulkExportFormat.md);
      const svc = makeService(tmpDir);
      const markdownBody = '# Hello\n\nSome **bold** text.';
      const snapshot = makePageSnapshot('/test/page', markdownBody);

      const writable = await getPageWritable.call(svc, job);
      await writeOneChunk(writable, snapshot);

      // The output file for md format has .md extension
      const outputPath = path.join(tmpDir, 'test', 'page.md');
      expect(fs.existsSync(outputPath)).toBe(true);

      const content = fs.readFileSync(outputPath, 'utf8');

      // Must be the original Markdown — no HTML rendering applied
      expect(content).toBe(markdownBody);
      // Must NOT have HTML artifacts
      expect(content).not.toContain('<link rel="stylesheet"');
      expect(content).not.toContain('<div class="wiki">');
      // md format does not produce the shared stylesheet (pdf-only).
      expect(fs.existsSync(path.join(tmpDir, '_bulk-export.css'))).toBe(false);
    }, 10_000);
  });

  // -------------------------------------------------------------------------
  // Requirement 3.2: when renderToHtml rejects, the Writable write callback
  // must receive the error so the existing error-handling path can update the
  // job state. The failure must NOT be silently swallowed.
  // -------------------------------------------------------------------------
  describe('error handling: conversion reject → write callback receives error (Requirement 3.2)', () => {
    it('calls the write callback with the render error when renderToHtml rejects', async () => {
      const renderError = new Error('render pipeline failed');

      // Intercept createBulkExportMarkdownRenderer so renderToHtml rejects.
      // vi.spyOn on a named export works because Vitest patches the module's
      // export binding; the production import statement sees the spy.
      const spy = vi
        .spyOn(RendererModule, 'createBulkExportMarkdownRenderer')
        .mockReturnValue({
          getCss: vi.fn().mockReturnValue('/* css */'),
          renderToHtml: vi.fn().mockRejectedValue(renderError),
        });

      const job = makeJob(PageBulkExportFormat.pdf);
      const svc = makeService(tmpDir);
      const snapshot = makePageSnapshot('/error/page', '# Will fail');

      const writable = await getPageWritable.call(svc, job);

      // Observable: write callback is called WITH an error (not undefined).
      await expect(writeOneChunk(writable, snapshot)).rejects.toThrow(
        'render pipeline failed',
      );

      // The output file must NOT exist — no partial output committed.
      const outputPath = path.join(tmpDir, 'error', 'page.html');
      expect(fs.existsSync(outputPath)).toBe(false);

      spy.mockRestore();
    });
  });
});

// ---------------------------------------------------------------------------
// Requirement 5.3: exportPagesToFsAsync resume behaviour.
//
// Resume is implemented at the query level: when lastExportedPagePath is set on
// the job, only snapshots with a greater path are read, so already-exported
// pages are excluded without in-stream filtering.
// ---------------------------------------------------------------------------
describe('export-pages-to-fs-async: exportPagesToFsAsync resume (Requirement 5.3)', () => {
  let tmpDir: string;

  beforeEach(() => {
    findManySnapshots.mockReset();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-export-resume-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Run the export and resolve once every snapshot has been written. */
  async function runExport(
    job: pagebulkexportjobs,
    pageBatchSize = 100,
  ): Promise<void> {
    const svc = mock<IPageBulkExportJobCronService>();
    svc.getTmpOutputDir.mockReturnValue(tmpDir);
    svc.pageBatchSize = pageBatchSize;

    const finished = new Promise<void>((resolve, reject) => {
      svc.setStreamsInExecution.mockImplementation((_jobId, _readable, w) => {
        (w as Writable).once('finish', resolve).once('error', reject);
      });
    });
    await exportPagesToFsAsync.call(svc, job);
    await finished;
  }

  it('reads only snapshots after lastExportedPagePath when it is set', async () => {
    const lastPath = '/already/exported';
    findManySnapshots
      .mockResolvedValueOnce([makePageSnapshot('/new/page', '# new')])
      .mockResolvedValueOnce([]);

    await runExport(makeJob(PageBulkExportFormat.md, lastPath));

    expect(findManySnapshots.mock.calls).toMatchObject([
      [
        {
          where: {
            pageBulkExportJobId: '000000000000000000000001',
            path: { gt: lastPath },
          },
        },
      ],
      [{ where: { path: { gt: '/new/page' } } }],
    ]);
    expect(fs.readFileSync(path.join(tmpDir, 'new/page.md'), 'utf8')).toBe(
      '# new',
    );
  });

  it('reads all snapshots of the job when lastExportedPagePath is not set', async () => {
    findManySnapshots
      .mockResolvedValueOnce([makePageSnapshot('/first', '# first')])
      .mockResolvedValueOnce([]);

    await runExport(makeJob(PageBulkExportFormat.md));

    expect(findManySnapshots.mock.calls).toEqual([
      [
        expect.objectContaining({
          where: { pageBulkExportJobId: '000000000000000000000001' },
        }),
      ],
      [
        expect.objectContaining({
          where: expect.objectContaining({ path: { gt: '/first' } }),
        }),
      ],
    ]);
    expect(fs.readdirSync(tmpDir)).toEqual(['first.md']);
  });

  it('continues batch by batch from the last path of the previous batch', async () => {
    findManySnapshots
      .mockResolvedValueOnce([
        makePageSnapshot('/a', '# a'),
        makePageSnapshot('/b', '# b'),
      ])
      .mockResolvedValueOnce([makePageSnapshot('/c', '# c')])
      .mockResolvedValueOnce([]);

    await runExport(makeJob(PageBulkExportFormat.md), 2);

    expect(findManySnapshots.mock.calls).toMatchObject([
      [{ take: 2 }],
      [{ take: 2, where: { path: { gt: '/b' } } }],
      [{ take: 2, where: { path: { gt: '/c' } } }],
    ]);
    expect(fs.readdirSync(tmpDir).sort()).toEqual(['a.md', 'b.md', 'c.md']);
  });
});

describe('export-pages-to-fs-async: unsupported format', () => {
  it.each([
    '/../../../escape',
    'docx',
    '',
  ])('refuses to start exporting a job whose format is %j', async (format) => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'bulk-export-bad-format-'),
    );
    const svc = makeService(tmpDir);

    try {
      await expect(
        getPageWritable.call(svc, makeJob(format)),
      ).rejects.toThrow();
      expect(fs.readdirSync(tmpDir)).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
