import fs from 'node:fs';
import path from 'node:path';
import { pipeline, Writable } from 'node:stream';
import { dynamicImport } from '@cspell/dynamic-import';
import { isPopulated } from '@growi/core';
import {
  getParentPath,
  normalizePath,
} from '@growi/core/dist/utils/path-utils';
import type { Root } from 'mdast';
import type * as RemarkHtml from 'remark-html';
import type * as RemarkParse from 'remark-parse';
import type * as Unified from 'unified';

import {
  PageBulkExportFormat,
  PageBulkExportJobStatus,
} from '~/features/page-bulk-export/interfaces/page-bulk-export';
import type { PageBulkExportJobDocument } from '../../../models/page-bulk-export-job';
import type { PageBulkExportPageSnapshotDocument } from '../../../models/page-bulk-export-page-snapshot';
import PageBulkExportPageSnapshot from '../../../models/page-bulk-export-page-snapshot';
import type { IPageBulkExportJobCronService } from '..';
import { BulkExportJobStreamDestroyedByCleanupError } from '../errors';

async function convertMdToHtml(
  md: string,
  htmlConverter: Unified.Processor<Root, undefined, undefined, Root, string>,
): Promise<string> {
  const htmlString = (await htmlConverter.process(md)).toString();

  return htmlString;
}

/**
 * Get a Writable that writes the page body temporarily to fs
 */
async function getPageWritable(
  this: IPageBulkExportJobCronService,
  pageBulkExportJob: PageBulkExportJobDocument,
): Promise<Writable> {
  const unified = (await dynamicImport<typeof Unified>('unified', __dirname))
    .unified;
  const remarkParse = (
    await dynamicImport<typeof RemarkParse>('remark-parse', __dirname)
  ).default;
  const remarkHtml = (
    await dynamicImport<typeof RemarkHtml>('remark-html', __dirname)
  ).default;

  const isHtmlPath = pageBulkExportJob.format === PageBulkExportFormat.pdf;
  const format =
    pageBulkExportJob.format === PageBulkExportFormat.pdf
      ? 'html'
      : pageBulkExportJob.format;
  const outputDir = this.getTmpOutputDir(pageBulkExportJob, isHtmlPath);
  // define before the stream starts to avoid creating multiple instances
  const htmlConverter = unified()
    .use(remarkParse)
    // !!! DO NOT DISABLE HTML ESCAPING WHILE --no-sandbox IS PASSED TO PUPPETEER INSIDE pdf-converter !!!
    .use(remarkHtml);
  return new Writable({
    objectMode: true,
    write: async (
      page: PageBulkExportPageSnapshotDocument,
      encoding,
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
            const htmlString = await convertMdToHtml(
              markdownBody,
              htmlConverter,
            );
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
  const pageSnapshotsReadable = PageBulkExportPageSnapshot.find(findQuery)
    .populate('revision')
    .sort({ path: 1 })
    .lean()
    .cursor({ batchSize: this.pageBatchSize });

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
