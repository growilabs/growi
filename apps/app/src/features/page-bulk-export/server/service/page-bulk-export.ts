import { type IPage, SubscriptionStatusType } from '@growi/core';
import mongoose from 'mongoose';

import type { pagebulkexportjobs } from '~/generated/prisma/client';
import { SupportedTargetModel } from '~/interfaces/activity';
import type { PageModel } from '~/server/models/page';
import Subscription from '~/server/models/subscription';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import type { PageBulkExportFormat } from '../../interfaces/page-bulk-export';
import {
  PageBulkExportJobInProgressStatus,
  PageBulkExportJobStatus,
} from '../../interfaces/page-bulk-export';

const logger = loggerFactory('growi:services:PageBulkExportService');

export class DuplicateBulkExportJobError extends Error {
  duplicateJob: pagebulkexportjobs;

  constructor(duplicateJob: pagebulkexportjobs) {
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

    const duplicatePageBulkExportJobInProgress =
      await prisma.pagebulkexportjobs.findFirst({
        where: {
          userId: currentUser._id.toString(),
          pageId: basePage._id.toString(),
          format,
          status: { in: Object.values(PageBulkExportJobInProgressStatus) },
        },
      });
    if (duplicatePageBulkExportJobInProgress != null) {
      if (restartJob) {
        await this.resetBulkExportJob(duplicatePageBulkExportJobInProgress);
        return;
      }
      throw new DuplicateBulkExportJobError(
        duplicatePageBulkExportJobInProgress,
      );
    }
    const pageBulkExportJob = await prisma.pagebulkexportjobs.create({
      data: {
        userId: currentUser._id.toString(),
        pageId: basePage._id.toString(),
        format,
        status: PageBulkExportJobStatus.initializing,
      },
    });

    await Subscription.upsertSubscription(
      currentUser,
      SupportedTargetModel.MODEL_PAGE_BULK_EXPORT_JOB,
      pageBulkExportJob.id,
      SubscriptionStatusType.SUBSCRIBE,
    );
  }

  /**
   * Reset page bulk export job in progress
   */
  async resetBulkExportJob(
    pageBulkExportJob: pagebulkexportjobs,
  ): Promise<void> {
    await prisma.pagebulkexportjobs.update({
      where: { id: pageBulkExportJob.id },
      data: { restartFlag: true },
    });
  }
}

export const pageBulkExportService: PageBulkExportService =
  new PageBulkExportService(); // singleton instance
