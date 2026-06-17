import fs from 'node:fs';
import path from 'node:path';
import { pipeline, Readable, Writable } from 'node:stream';
import { isPopulated } from '@growi/core';
import {
  getParentPath,
  normalizePath,
} from '@growi/core/dist/utils/path-utils';

import {
  PageBulkExportFormat,
  PageBulkExportJobStatus,
} from '~/features/page-bulk-export/interfaces/page-bulk-export';
import loggerFactory from '~/utils/logger';

import type { PageBulkExportJobDocument } from '../../../models/page-bulk-export-job';
import type { PageBulkExportPageSnapshotDocument } from '../../../models/page-bulk-export-page-snapshot';
import PageBulkExportPageSnapshot from '../../../models/page-bulk-export-page-snapshot';
import type { IPageBulkExportJobCronService } from '..';
import { BulkExportJobStreamDestroyedByCleanupError } from '../errors';
import { createBulkExportMarkdownRenderer } from '../markdown';

const logger = loggerFactory(
  'growi:features:page-bulk-export:export-pages-to-fs-async',
);

/**
 * Filename of the shared stylesheet written once per job into the html output
 * dir. Every page links to it relatively, so the CSS is not duplicated per page.
 * The leading underscore keeps it out of the page namespace; pdf-converter only
 * scans `*.html`, so this file is never mistaken for a page to convert.
 */
const SHARED_CSS_FILENAME = '_bulk-export.css';

/**
 * Compute the `<link href>` for the shared stylesheet, relative to the page's
 * own HTML file. A page at `html/{jobId}/a/b.html` links to `../_bulk-export.css`.
 * Path segments are URL-encoded so the href is valid even on deeply nested pages.
 */
function toCssHref(pageFilePath: string, cssFilePath: string): string {
  const relativePath = path.relative(path.dirname(pageFilePath), cssFilePath);
  return relativePath.split(path.sep).map(encodeURIComponent).join('/');
}

/**
 * Get a Writable that writes the page body temporarily to fs.
 *
 * For pdf format: Markdown is rendered to a sanitized HTML document that links
 * the shared stylesheet (written once per job here) and wraps the content in a
 * `.wiki` container (Requirements 5.1, 2.1, 2.2).
 *
 * For md format: Markdown is written as-is without any HTML rendering
 * (Requirement 5.2).
 *
 * Resume logic (lastExportedPagePath) and error-callback behaviour are
 * preserved unchanged (Requirements 5.3, 3.2).
 */
export async function getPageWritable(
  this: IPageBulkExportJobCronService,
  pageBulkExportJob: PageBulkExportJobDocument,
): Promise<Writable> {
  const isHtmlPath = pageBulkExportJob.format === PageBulkExportFormat.pdf;
  const format =
    pageBulkExportJob.format === PageBulkExportFormat.pdf
      ? 'html'
      : pageBulkExportJob.format;
  const outputDir = this.getTmpOutputDir(pageBulkExportJob, isHtmlPath);

  // Build renderer once — reused for every page in the job.
  // BulkExportMarkdownRenderer caches the unified pipeline at module level.
  const renderer = createBulkExportMarkdownRenderer(__dirname);

  // For pdf format, write the shared stylesheet once per job. Every page links
  // to it relatively, so the (~MB) CSS is not duplicated into each page's HTML.
  const cssFilePath = path.join(outputDir, SHARED_CSS_FILENAME);
  if (isHtmlPath) {
    await fs.promises.mkdir(outputDir, { recursive: true });
    await fs.promises.writeFile(cssFilePath, renderer.getCss());
  }

  return new Writable({
    objectMode: true,
    write: async (
      page: PageBulkExportPageSnapshotDocument,
      _encoding,
      callback,
    ) => {
      try {
        const revision = page.revision;

        if (revision != null && isPopulated(revision)) {
          const markdownBody = revision.body;
          const pathNormalized = `${normalizePath(page.path)}.${format}`;
          const fileOutputPath = path.join(outputDir, pathNormalized);
          const fileOutputParentPath = getParentPath(fileOutputPath);

          await fs.promises.mkdir(fileOutputParentPath, { recursive: true });
          if (pageBulkExportJob.format === PageBulkExportFormat.md) {
            await fs.promises.writeFile(fileOutputPath, markdownBody);
          } else {
            // Render Markdown → sanitized HTML document linking the shared
            // stylesheet (relative to this page) and wrapped in a .wiki container.
            // If renderToHtml rejects, the error propagates to callback(err) below,
            // letting the existing error-handling path update the job state (Req 3.2).
            const cssHref = toCssHref(fileOutputPath, cssFilePath);
            let htmlString: string;
            try {
              htmlString = await renderer.renderToHtml(markdownBody, cssHref);
            } catch (renderErr) {
              logger.warn(
                'BulkExportMarkdownRenderer failed for page %s: %o',
                page.path,
                renderErr,
              );
              throw renderErr;
            }
            await fs.promises.writeFile(fileOutputPath, htmlString);
          }
          pageBulkExportJob.lastExportedPagePath = page.path;
          await pageBulkExportJob.save();
        }
      } catch (err) {
        callback(err);
        return;
      }
      callback();
    },
    final: async (callback) => {
      try {
        // If the format is md, the export process ends here.
        // If the format is pdf, pdf conversion in pdf-converter has to finish.
        if (pageBulkExportJob.format === PageBulkExportFormat.md) {
          pageBulkExportJob.status = PageBulkExportJobStatus.uploading;
          await pageBulkExportJob.save();
        }
      } catch (err) {
        callback(err);
        return;
      }
      callback();
    },
  });
}

/**
 * Export pages to the file system before compressing and uploading to the cloud storage.
 * The export will resume from the last exported page if the process was interrupted.
 */
export async function exportPagesToFsAsync(
  this: IPageBulkExportJobCronService,
  pageBulkExportJob: PageBulkExportJobDocument,
): Promise<void> {
  const findQuery =
    pageBulkExportJob.lastExportedPagePath != null
      ? {
          pageBulkExportJob,
          path: { $gt: pageBulkExportJob.lastExportedPagePath },
        }
      : { pageBulkExportJob };
  const pageSnapshotsCursor = PageBulkExportPageSnapshot.find(findQuery)
    .populate('revision')
    .sort({ path: 1 })
    .lean()
    .cursor({ batchSize: this.pageBatchSize });
  // Wrap Mongoose Cursor with Readable.from() for proper type compatibility
  const pageSnapshotsReadable = Readable.from(pageSnapshotsCursor);

  const pagesWritable = await getPageWritable.bind(this)(pageBulkExportJob);

  this.setStreamsInExecution(
    pageBulkExportJob._id,
    pageSnapshotsReadable,
    pagesWritable,
  );

  pipeline(pageSnapshotsReadable, pagesWritable, (err) => {
    // prevent overlapping cleanup
    if (!(err instanceof BulkExportJobStreamDestroyedByCleanupError)) {
      this.handleError(err, pageBulkExportJob);
    }
  });
}
