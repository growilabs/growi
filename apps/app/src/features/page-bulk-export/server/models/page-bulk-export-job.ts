import { type Document, type Model, Schema } from 'mongoose';

import {
  PageBulkExportFormat,
  PageBulkExportJobStatus,
} from '~/features/page-bulk-export/interfaces/page-bulk-export.js';
import { getOrCreateModel } from '~/server/util/mongoose-utils.js';

import type { IPageBulkExportJob } from '../../interfaces/page-bulk-export.js';

export interface PageBulkExportJobDocument
  extends IPageBulkExportJob,
    Document {}

export type PageBulkExportJobModel = Model<PageBulkExportJobDocument>;

const pageBulkExportJobSchema = new Schema<PageBulkExportJobDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    page: { type: Schema.Types.ObjectId, ref: 'Page', required: true },
    lastExportedPagePath: { type: String },
    format: {
      type: String,
      enum: Object.values(PageBulkExportFormat),
      required: true,
    },
    completedAt: { type: Date },
    attachment: { type: Schema.Types.ObjectId, ref: 'Attachment' },
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
  },
  { timestamps: true },
);

export default getOrCreateModel<
  PageBulkExportJobDocument,
  PageBulkExportJobModel
>('PageBulkExportJob', pageBulkExportJobSchema);
