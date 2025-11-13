import { type IPage, SubscriptionStatusType } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { SupportedTargetModel } from '~/interfaces/activity';
import type { PageModel } from '~/server/models/page';
import Subscription from '~/server/models/subscription';
import loggerFactory from '~/utils/logger';

import type { PageBulkExportFormat } from '../../interfaces/page-bulk-export';
import {
  PageBulkExportJobInProgressStatus,
  PageBulkExportJobStatus,
} from '../../interfaces/page-bulk-export';
import type { PageBulkExportJobDocument } from '../models/page-bulk-export-job';
import PageBulkExportJob from '../models/page-bulk-export-job';

const logger = loggerFactory('growi:services:PageBulkExportService');

export class DuplicateBulkExportJobError extends Error {
  duplicateJob: HydratedDocument<PageBulkExportJobDocument>;

  constructor(duplicateJob: HydratedDocument<PageBulkExportJobDocument>) {
    super('Duplicate bulk export job is in progress');
    this.duplicateJob = duplicateJob;
  }
}

export interface IPageBulkExportService {
  createOrResetBulkExportJob: (
    basePagePath: string,
    currentUser,
    restartJob?: boolean,
  ) => Promise<void>;
}

class PageBulkExportService implements IPageBulkExportService {
  /**
   * Create a new page bulk export job or reset the existing one
   */
  async createOrResetBulkExportJob(
    basePagePath: string,
    format: PageBulkExportFormat,
    currentUser,
    restartJob = false,
  ): Promise<void> {
    const Page = mongoose.model<IPage, PageModel>('Page');
    const basePage = await Page.findByPathAndViewer(
      basePagePath,
      currentUser,
      null,
      true,
    );

    if (basePage == null) {
      throw new Error('Base page not found or not accessible');
    }

    const duplicatePageBulkExportJobInProgress: HydratedDocument<PageBulkExportJobDocument> | null =
      await PageBulkExportJob.findOne({
        user: { $eq: currentUser },
        page: basePage,
        format: { $eq: format },
        $or: Object.values(PageBulkExportJobInProgressStatus).map((status) => ({
          status,
        })),
      });
    if (duplicatePageBulkExportJobInProgress != null) {
      if (restartJob) {
        this.resetBulkExportJob(duplicatePageBulkExportJobInProgress);
        return;
      }
      throw new DuplicateBulkExportJobError(
        duplicatePageBulkExportJobInProgress,
      );
    }
    const pageBulkExportJob: HydratedDocument<PageBulkExportJobDocument> =
      await PageBulkExportJob.create({
        user: currentUser,
        page: basePage,
        format,
        status: PageBulkExportJobStatus.initializing,
      });

    await Subscription.upsertSubscription(
      currentUser,
      SupportedTargetModel.MODEL_PAGE_BULK_EXPORT_JOB,
      pageBulkExportJob,
      SubscriptionStatusType.SUBSCRIBE,
    );
  }

  /**
   * Reset page bulk export job in progress
   */
  async resetBulkExportJob(
    pageBulkExportJob: HydratedDocument<PageBulkExportJobDocument>,
  ): Promise<void> {
    pageBulkExportJob.restartFlag = true;
    await pageBulkExportJob.save();
  }
}

export const pageBulkExportService: PageBulkExportService =
  new PageBulkExportService(); // singleton instance
