import { Schema } from 'mongoose';

import { Prisma } from '~/generated/prisma/client';
import { AllSupportedActions } from '~/interfaces/activity';
import { getOrCreateModel } from '~/server/util/mongoose-utils';

import {
  AuditLogBulkExportFormat,
  AuditLogBulkExportJobStatus,
} from '../../interfaces/audit-log-bulk-export';

// TODO: remove mongoose model and use `prisma db push` after all models are migrated to prisma.
// Until then, use mongoose to automatically create collections and indexes when connected.
const auditLogBulkExportJobSchema = new Schema({
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
});

getOrCreateModel('AuditLogBulkExportJob', auditLogBulkExportJobSchema);

export const extension = Prisma.defineExtension((client) => {
  return client.$extends({
    result: {
      auditlogbulkexportjobs: {
        // for backward compatibility with mongoose
        _id: {
          needs: { id: true },
          compute(model) {
            return model.id;
          },
        },
        // for backward compatibility with mongoose
        __v: {
          needs: { v: true },
          compute(model) {
            return model.v;
          },
        },
      },
    },
  });
});
