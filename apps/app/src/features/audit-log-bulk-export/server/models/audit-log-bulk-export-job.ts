import type { HydratedDocument } from 'mongoose';
import { type Model, Schema } from 'mongoose';

import { AllSupportedActions } from '~/interfaces/activity';
import { getOrCreateModel } from '~/server/util/mongoose-utils';

import type { IAuditLogBulkExportJob } from '../../interfaces/audit-log-bulk-export';
import {
  AuditLogBulkExportFormat,
  AuditLogBulkExportJobStatus,
} from '../../interfaces/audit-log-bulk-export';

export type AuditLogBulkExportJobDocument =
  HydratedDocument<IAuditLogBulkExportJob>;

export type AuditLogBulkExportJobModel = Model<AuditLogBulkExportJobDocument>;

const auditLogBulkExportJobSchema = new Schema<IAuditLogBulkExportJob>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    filters: {
      type: {
        users: [{ type: Schema.Types.ObjectId, ref: 'User' }],
        actions: [{ type: String, enum: AllSupportedActions }],
        dateFrom: { type: Date },
        dateTo: { type: Date },
      },
      required: true,
    },
    filterHash: { type: String, required: true, index: true },
    format: {
      type: String,
      enum: Object.values(AuditLogBulkExportFormat),
      required: true,
      default: AuditLogBulkExportFormat.json,
    },
    status: {
      type: String,
      enum: Object.values(AuditLogBulkExportJobStatus),
      required: true,
      default: AuditLogBulkExportJobStatus.exporting,
    },
    lastExportedId: { type: String },
    completedAt: { type: Date },
    restartFlag: { type: Boolean, required: true, default: false },
    totalExportedCount: { type: Number, default: 0 },
    attachment: { type: Schema.Types.ObjectId, ref: 'Attachment' },
  },
  { timestamps: true },
);

export default getOrCreateModel<
  AuditLogBulkExportJobDocument,
  AuditLogBulkExportJobModel
>('AuditLogBulkExportJob', auditLogBulkExportJobSchema);
