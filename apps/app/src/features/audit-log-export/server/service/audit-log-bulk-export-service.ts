import { createHash } from 'crypto';

import { SubscriptionStatusType } from '@growi/core';
import type { IUserHasId } from '@growi/core';
import type { HydratedDocument } from 'mongoose';

import { SupportedTargetModel } from '~/interfaces/activity';
import Subscription from '~/server/models/subscription';
import loggerFactory from '~/utils/logger';

import type {
  IAuditLogExportFilters,
  AuditLogExportFormat,
} from '../../interfaces/audit-log-bulk-export';
import {
  AuditLogExportJobInProgressStatus,
  AuditLogExportJobStatus,
} from '../../interfaces/audit-log-bulk-export';
import type { AuditLogExportJobDocument } from '../models/audit-log-bulk-export-job';
import AuditLogExportJob from '../models/audit-log-bulk-export-job';

const logger = loggerFactory('growi:services:AuditLogExportService');

export class DuplicateAuditLogExportJobError extends Error {

  duplicateJob: HydratedDocument<AuditLogExportJobDocument>;

  constructor(duplicateJob: HydratedDocument<AuditLogExportJobDocument>) {
    super('Duplicate audit-log export job is in progress');
    this.duplicateJob = duplicateJob;
  }

}

export interface IAuditLogExportService {
  createOrResetExportJob: (
    filters: IAuditLogExportFilters,
    format: AuditLogExportFormat,
    currentUser: IUserHasId,
    restartJob?: boolean,
  ) => Promise<void>;

  resetExportJob: (
    job: HydratedDocument<AuditLogExportJobDocument>,
  ) => Promise<void>;
}

/** ===== utils ===== */

function canonicalizeFilters(filters: IAuditLogExportFilters) {
  // users/actions は配列をソート、日付は ISO に正規化
  const normalized: Record<string, unknown> = {};

  if (filters.users?.length) {
    normalized.users = filters.users.map(String).sort();
  }
  if (filters.actions?.length) {
    normalized.actions = [...filters.actions].sort();
  }
  if (filters.dateFrom) {
    normalized.dateFrom = new Date(filters.dateFrom).toISOString();
  }
  if (filters.dateTo) {
    normalized.dateTo = new Date(filters.dateTo).toISOString();
  }
  return normalized;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** ===== service ===== */

class AuditLogExportService implements IAuditLogExportService {

  /**
   * Create a new audit-log export job or reset the existing one
   */
  async createOrResetExportJob(
      filters: IAuditLogExportFilters,
      format: AuditLogExportFormat,
      currentUser: IUserHasId,
      restartJob = false,
  ): Promise<void> {
    // 1) フィルタの正規化とハッシュ化
    const normalizedFilters = canonicalizeFilters(filters);
    const filterHash = sha256(JSON.stringify(normalizedFilters));

    // 2) 実行中ジョブの重複チェック（同一 user + 同一 filterHash + in-progress）
    const duplicateInProgress: HydratedDocument<AuditLogExportJobDocument> | null = await AuditLogExportJob.findOne({
      user: { $eq: currentUser },
      filterHash,
      $or: Object.values(AuditLogExportJobInProgressStatus).map(status => ({ status })),
    });

    if (duplicateInProgress != null) {
      if (restartJob) {
        await this.resetExportJob(duplicateInProgress);
        return;
      }
      throw new DuplicateAuditLogExportJobError(duplicateInProgress);
    }

    // 3) 対象の上限境界を固定（ジョブ開始時点以降の増加を除外）
    const upperBoundAt = new Date();

    // 4) より強力な重複検知用シグネチャ（同条件 + 同境界）
    const matchSignature = sha256(`${filterHash}|${upperBoundAt.toISOString()}`);

    // 5) ジョブ作成
    const job: HydratedDocument<AuditLogExportJobDocument> = await AuditLogExportJob.create({
      user: currentUser,
      filters: normalizedFilters,
      filterHash,
      format,
      status: AuditLogExportJobStatus.exporting,
      upperBoundAt,
      matchSignature,
      totalExportedCount: 0,
    });

    // 6) 通知購読（UI の進捗通知などに利用）
    try {
      await Subscription.upsertSubscription(
        currentUser,
        SupportedTargetModel.MODEL_AUDIT_LOG_EXPORT_JOB,
        job,
        SubscriptionStatusType.SUBSCRIBE,
      );
    }
    catch (e) {
      // 購読設定に失敗してもジョブ自体は成立させる
      logger.warn('Subscription upsert failed for AuditLogExportJob', e);
    }
  }

  /**
   * Reset audit-log export job in progress
   */
  async resetExportJob(
      job: HydratedDocument<AuditLogExportJobDocument>,
  ): Promise<void> {
    job.restartFlag = true;
    await job.save();
  }

}

export const auditLogExportService = new AuditLogExportService(); // singleton
