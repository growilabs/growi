import type { IPage } from '@growi/core';
import mongoose from 'mongoose';

import type { pagebulkexportjobs } from '~/generated/prisma/client';
import type { PageModel } from '~/server/models/page';

// Re-export client-safe types and functions
export type { IPageBulkExportJobSnapshot } from './page-bulk-export-job-client';
export { parseSnapshot } from './page-bulk-export-job-client';

export const stringifySnapshot = async (
  exportJob: pagebulkexportjobs,
): Promise<string | undefined> => {
  const Page = mongoose.model<IPage, PageModel>('Page');
  const page = await Page.findById(exportJob.pageId);

  if (page != null) {
    return JSON.stringify({
      path: page.path,
    });
  }
};
