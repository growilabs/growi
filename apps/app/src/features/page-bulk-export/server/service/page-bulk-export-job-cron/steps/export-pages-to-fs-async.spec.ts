/**
 * Smoke tests for export-pages-to-fs-async (Task 5.1).
 *
 * Observable contract verified here:
 *  - PDF format: output HTML file contains <style> tag with CSS content.
 *  - PDF format: output HTML file contains <div class="wiki"> wrapper.
 *  - MD format: output file is written as-is (no HTML rendering applied).
 *
 * Edge cases (md unchanged, error handling, resume) are covered in task 7.1.
 *
 * Requirements: 3.2, 5.1, 5.2, 5.3
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Writable } from 'node:stream';
import type { IRevisionHasId } from '@growi/core';
import { mock } from 'vitest-mock-extended';

import {
  PageBulkExportFormat,
  PageBulkExportJobStatus,
} from '~/features/page-bulk-export/interfaces/page-bulk-export';

import type { PageBulkExportJobDocument } from '../../../models/page-bulk-export-job';
import type { PageBulkExportPageSnapshotDocument } from '../../../models/page-bulk-export-page-snapshot';
import type { IPageBulkExportJobCronService } from '..';
import { getPageWritable } from './export-pages-to-fs-async';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal IPageBulkExportJobCronService mock that returns tmpDir
 * from getTmpOutputDir().
 */
function makeService(tmpDir: string): IPageBulkExportJobCronService {
  const svc = mock<IPageBulkExportJobCronService>();
  svc.getTmpOutputDir.mockReturnValue(tmpDir);
  return svc;
}

/**
 * Build a minimal PageBulkExportJobDocument mock for the given format.
 */
function makeJob(format: PageBulkExportFormat): PageBulkExportJobDocument {
  const job = mock<PageBulkExportJobDocument>({
    format,
    lastExportedPagePath: undefined,
    status: PageBulkExportJobStatus.exporting,
  });
  // save() must resolve for the Writable to call callback()
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
    // Simulate a populated revision (isPopulated() returns true when it's an object, not an ID).
    revision: mock<IRevisionHasId>({ body: markdownBody }),
  });
}

/**
 * Write one page snapshot through a Writable and wait for it to complete.
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

  describe('PDF format smoke test (Requirements 5.1, 2.1)', () => {
    it('produces an HTML file with <style> tag and <div class="wiki"> wrapper for pdf format', async () => {
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

      // Must have a <style> block (CSS injected) — Requirement 2.1 / 5.1
      expect(content).toMatch(/<style>/);
      expect(content).toMatch(/<\/style>/);

      // Must have the .wiki wrapper — design.md § BulkExportStyleProvider
      expect(content).toContain('<div class="wiki">');
      expect(content).toContain('</div>');

      // CSS must be non-empty
      const cssMatch = content.match(/<style>([\s\S]*?)<\/style>/);
      expect(cssMatch).not.toBeNull();
      expect(cssMatch?.[1]?.trim().length).toBeGreaterThan(0);
    }, 30_000); // allow time for dynamicImport on first run
  });

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
      expect(content).not.toContain('<style>');
      expect(content).not.toContain('<div class="wiki">');
    }, 10_000);
  });
});
