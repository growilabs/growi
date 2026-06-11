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
 *  - Resume: exportPagesToFsAsync queries only pages after lastExportedPagePath
 *    when that field is set on the job. (Req 5.3)
 *  - Resume (no prior export): full scan when lastExportedPagePath is unset.
 *
 * Requirements: 3.2, 5.1, 5.2, 5.3
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Writable } from 'node:stream';
import { Readable } from 'node:stream';
import type { IRevisionHasId } from '@growi/core';
import { mock } from 'vitest-mock-extended';

import {
  PageBulkExportFormat,
  PageBulkExportJobStatus,
} from '~/features/page-bulk-export/interfaces/page-bulk-export';

import type { PageBulkExportJobDocument } from '../../../models/page-bulk-export-job';
import type { PageBulkExportPageSnapshotDocument } from '../../../models/page-bulk-export-page-snapshot';
import type { IPageBulkExportJobCronService } from '..';
import * as RendererModule from '../markdown';
import {
  exportPagesToFsAsync,
  getPageWritable,
} from './export-pages-to-fs-async';

// ---------------------------------------------------------------------------
// Module-level mock for PageBulkExportPageSnapshot (resume tests).
// The model registers with Mongoose at init time; mocking avoids the need for
// a live MongoDB connection in unit tests.
// ---------------------------------------------------------------------------
vi.mock('../../../models/page-bulk-export-page-snapshot', () => {
  return { default: { find: vi.fn() } };
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
 * Build a minimal PageBulkExportJobDocument mock for the given format.
 * lastExportedPagePath defaults to undefined (no prior export).
 */
function makeJob(
  format: PageBulkExportFormat,
  lastExportedPagePath?: string,
): PageBulkExportJobDocument {
  const job = mock<PageBulkExportJobDocument>({
    format,
    lastExportedPagePath,
    status: PageBulkExportJobStatus.exporting,
  });
  job.save.mockResolvedValue(job);
  return job;
}

/**
 * Build a minimal PageBulkExportPageSnapshotDocument mock with inline revision.
 */
function makePageSnapshot(
  pagePath: string,
  markdownBody: string,
): PageBulkExportPageSnapshotDocument {
  return mock<PageBulkExportPageSnapshotDocument>({
    path: pagePath,
    // isPopulated() returns true when revision is an object (not an ObjectId).
    revision: mock<IRevisionHasId>({ body: markdownBody }),
  });
}

/**
 * Write one page snapshot through a Writable and wait for the callback.
 * Resolves on success; rejects with the error passed to callback on failure.
 */
function writeOneChunk(
  writable: Writable,
  snapshot: PageBulkExportPageSnapshotDocument,
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
// The resume contract is implemented at the query level: when
// lastExportedPagePath is set on the job, the MongoDB find query includes
// { path: { $gt: lastExportedPagePath } } so that already-exported pages are
// excluded from the cursor without in-stream filtering.
// ---------------------------------------------------------------------------
describe('export-pages-to-fs-async: exportPagesToFsAsync resume (Requirement 5.3)', () => {
  /**
   * Build a minimal cursor chain mock that Readable.from() can consume.
   * find() → { populate, sort, lean, cursor } → async iterable of []
   */
  function makeCursorChain(): ReturnType<typeof vi.fn> {
    const cursor = Readable.from([]);
    // Each chained method returns an object that ultimately yields cursor
    const chain = {
      populate: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      lean: vi.fn().mockReturnThis(),
      cursor: vi.fn().mockReturnValue(cursor),
    };
    return vi.fn().mockReturnValue(chain);
  }

  it('queries pages with $gt filter when lastExportedPagePath is set', async () => {
    // Import the mocked model (vi.mock hoists this to module scope).
    const { default: PageBulkExportPageSnapshot } = await import(
      '../../../models/page-bulk-export-page-snapshot'
    );

    const findSpy = vi
      .spyOn(PageBulkExportPageSnapshot, 'find')
      .mockImplementation(makeCursorChain());

    const lastPath = '/already/exported';
    const job = makeJob(PageBulkExportFormat.pdf, lastPath);

    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'bulk-export-resume-'),
    );
    const svc = mock<IPageBulkExportJobCronService>();
    svc.getTmpOutputDir.mockReturnValue(tmpDir);
    // setStreamsInExecution and handleError are called by exportPagesToFsAsync
    svc.setStreamsInExecution.mockReturnValue(undefined);
    svc.handleError.mockReturnValue(undefined);

    try {
      await exportPagesToFsAsync.call(svc, job);

      // Observable: find() was called with a query that includes $gt on path
      expect(findSpy).toHaveBeenCalledOnce();
      const [queryArg] = findSpy.mock.calls[0];
      expect(queryArg).toMatchObject({
        pageBulkExportJob: job,
        path: { $gt: lastPath },
      });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      findSpy.mockRestore();
    }
  });

  it('queries all pages (no $gt filter) when lastExportedPagePath is not set', async () => {
    const { default: PageBulkExportPageSnapshot } = await import(
      '../../../models/page-bulk-export-page-snapshot'
    );

    const findSpy = vi
      .spyOn(PageBulkExportPageSnapshot, 'find')
      .mockImplementation(makeCursorChain());

    const job = makeJob(PageBulkExportFormat.pdf); // lastExportedPagePath = undefined

    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'bulk-export-resume-full-'),
    );
    const svc = mock<IPageBulkExportJobCronService>();
    svc.getTmpOutputDir.mockReturnValue(tmpDir);
    svc.setStreamsInExecution.mockReturnValue(undefined);
    svc.handleError.mockReturnValue(undefined);

    try {
      await exportPagesToFsAsync.call(svc, job);

      // Observable: find() was called with only the job filter (no path $gt)
      expect(findSpy).toHaveBeenCalledOnce();
      const [queryArg] = findSpy.mock.calls[0];
      expect(queryArg).toEqual({ pageBulkExportJob: job });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      findSpy.mockRestore();
    }
  });
});
