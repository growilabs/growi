import { type Document, type Model, Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

import type { IAuditLogExportJob } from '../../interfaces/audit-log-bulk-export';
import {
  AuditLogExportFormat,
  AuditLogExportJobStatus,
} from '../../interfaces/audit-log-bulk-export';

export interface AuditLogExportJobDocument
  extends IAuditLogExportJob,
    Document {}

export type AuditLogExportJobModel = Model<AuditLogExportJobDocument>;

const auditLogExportJobSchema = new Schema<AuditLogExportJobDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    filters: { type: Schema.Types.Mixed, required: true },
    filterHash: { type: String, required: true, index: true },
    format: {
      type: String,
      enum: Object.values(AuditLogExportFormat),
      required: true,
      default: AuditLogExportFormat.json,
    },
    status: {
      type: String,
      enum: Object.values(AuditLogExportJobStatus),
      required: true,
      default: AuditLogExportJobStatus.exporting,
    },
    statusOnPreviousCronExec: {
      type: String,
      enum: Object.values(AuditLogExportJobStatus),
    },
    upperBoundAt: { type: Date },
    lastExportedAt: { type: Date },
    lastExportedId: { type: String },
    completedAt: { type: Date },
    attachment: { type: Schema.Types.ObjectId, ref: 'Attachment' },
    matchSignature: { type: String, index: true },
    restartFlag: { type: Boolean, required: true, default: false },
    totalExportedCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    minimize: false,
  },
);

auditLogExportJobSchema.index({ status: 1, updatedAt: 1 });
auditLogExportJobSchema.index({ lastExportedAt: 1, lastExportedId: 1 });

export default getOrCreateModel<AuditLogExportJobDocument, AuditLogExportJobModel>(
  'AuditLogExportJob',
  auditLogExportJobSchema,
);
