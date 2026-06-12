import type { Model } from 'mongoose';
import { Schema } from 'mongoose';

import loggerFactory from '~/utils/logger';

import { getOrCreateModel } from '../util/mongoose-utils';

const logger = loggerFactory('growi:models:auditlog-es-sync-status');

const KEY = 'auditlogs';

export interface IAuditlogEsSyncStatus {
  key: string;
  hasUnsyncedEvents: boolean;
}

interface IAuditlogEsSyncStatusModel extends Model<IAuditlogEsSyncStatus> {
  setUnsynced(value: boolean): Promise<void>;
  isUnsynced(): Promise<boolean>;
}

const schema = new Schema<IAuditlogEsSyncStatus, IAuditlogEsSyncStatusModel>(
  {
    key: { type: String, required: true, unique: true },
    hasUnsyncedEvents: { type: Boolean, required: true, default: false },
  },
  { collection: 'auditlog_es_sync_status' },
);

schema.statics.setUnsynced = async function (value: boolean): Promise<void> {
  try {
    await this.findOneAndUpdate(
      { key: KEY },
      { hasUnsyncedEvents: value },
      { upsert: true },
    );
  } catch (err) {
    logger.error('AuditlogEsSyncStatus.setUnsynced failed.', err);
  }
};

schema.statics.isUnsynced = async function (): Promise<boolean> {
  try {
    const doc = await this.findOne({ key: KEY });
    return doc?.hasUnsyncedEvents ?? false;
  } catch (err) {
    logger.error('AuditlogEsSyncStatus.isUnsynced failed.', err);
    return false;
  }
};

export const AuditlogEsSyncStatus = getOrCreateModel<
  IAuditlogEsSyncStatus,
  IAuditlogEsSyncStatusModel
>('AuditlogEsSyncStatus', schema);
