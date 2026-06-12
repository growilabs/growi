import type { IPage } from '@growi/core';
import { isPopulated } from '@growi/core';
import mongoose from 'mongoose';

import type { IPageBulkExportJob } from '~/features/page-bulk-export/interfaces/page-bulk-export.js';
import type { PageModel } from '~/server/models/page.js';

// Re-export client-safe types and functions
export type { IPageBulkExportJobSnapshot } from './page-bulk-export-job-client.js';
export { parseSnapshot } from '~/models/serializers/in-app-notification-snapshot/page-bulk-export-job-client.js';

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
