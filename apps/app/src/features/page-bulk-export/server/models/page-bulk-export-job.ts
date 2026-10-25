import { Schema } from 'mongoose';

import { Prisma } from '~/generated/prisma/client';
import { getOrCreateModel } from '~/server/util/mongoose-utils';

import {
  PageBulkExportFormat,
  PageBulkExportJobStatus,
} from '../../interfaces/page-bulk-export';

// TODO: remove mongoose model and use `prisma db push` after all models are migrated to prisma.
// Until then, use mongoose to automatically create collections and indexes when connected.
const pageBulkExportJobSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  page: { type: Schema.Types.ObjectId, ref: 'Page', required: true },
  lastExportedPagePath: { type: String },
  format: {
    type: String,
    enum: Object.values(PageBulkExportFormat),
    required: true,
  },
  completedAt: { type: Date },
  // indexed because Prisma's SetNull emulation filters jobs by attachment on every attachment delete
  attachment: { type: Schema.Types.ObjectId, ref: 'Attachment', index: true },
  status: {
    type: String,
    enum: Object.values(PageBulkExportJobStatus),
    required: true,
    default: PageBulkExportJobStatus.initializing,
  },
  statusOnPreviousCronExec: {
    type: String,
    enum: Object.values(PageBulkExportJobStatus),
  },
  restartFlag: { type: Boolean, required: true, default: false },
  revisionListHash: { type: String },
});

getOrCreateModel('PageBulkExportJob', pageBulkExportJobSchema);

export const extension = Prisma.defineExtension((client) => {
  return client.$extends({
    result: {
      pagebulkexportjobs: {
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
