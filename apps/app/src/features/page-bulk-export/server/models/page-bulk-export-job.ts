import { type Document, type Model, Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

import type { IPageBulkExportJob } from '../../interfaces/page-bulk-export';
import {
  PageBulkExportFormat,
  PageBulkExportJobStatus,
} from '../../interfaces/page-bulk-export';

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
