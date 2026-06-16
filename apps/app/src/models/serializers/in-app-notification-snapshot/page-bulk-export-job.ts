import type { IPage } from '@growi/core';
import { isPopulated } from '@growi/core';
import mongoose from 'mongoose';

import type { IPageBulkExportJob } from '~/features/page-bulk-export/interfaces/page-bulk-export';
import type { PageModel } from '~/server/models/page';

// Re-export client-safe types and functions
export type { IPageBulkExportJobSnapshot } from './page-bulk-export-job-client';
export { parseSnapshot } from './page-bulk-export-job-client';

export const stringifySnapshot = async (
  exportJob: IPageBulkExportJob,
): Promise<string | undefined> => {
  const Page = mongoose.model<IPage, PageModel>('Page');
  const page = isPopulated(exportJob.page)
    ? exportJob.page
    : await Page.findById(exportJob.page);

  if (page != null) {
    return JSON.stringify({
      path: page.path,
    });
  }
};
