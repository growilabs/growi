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
 *
 * Resume and batching (Req 5.3) are covered against a real database in
 * export-pages-to-fs-async.integ.ts.
 *
 * Requirements: 3.2, 5.1, 5.2
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
import { getPageWritable } from './export-pages-to-fs-async';

// The job's progress writes (lastExportedPagePath / status) go through prisma.
// Stub the client so this unit test needs no database.
vi.mock('~/utils/prisma', () => {
  return {
    prisma: {
      pagebulkexportjobs: {
        update: vi.fn(() => Promise.resolve({})),
      },
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
    id: `id:${pagePath}`,
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
