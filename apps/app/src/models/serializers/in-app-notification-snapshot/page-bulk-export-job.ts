import type { IPage } from '@growi/core';
import { isPopulated } from '@growi/core';
import mongoose from 'mongoose';

import type { IPageBulkExportJob } from '~/features/page-bulk-export/interfaces/page-bulk-export';
import type { PageModel } from '~/server/models/page';

export interface IPageBulkExportJobSnapshot {
  path: string;
}

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

export const parseSnapshot = (snapshot: string): IPageBulkExportJobSnapshot => {
  return JSON.parse(snapshot);
};
