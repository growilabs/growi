import { type Document, type Model, Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils';

import type { IPageBulkExportJob } from '../../interfaces/page-bulk-export';
import { PageBulkExportFormat } from '../../interfaces/page-bulk-export';

export interface PageBulkExportJobDocument extends IPageBulkExportJob, Document {}

export type PageBulkExportJobModel = Model<PageBulkExportJobDocument>

const pageBulkExportJobSchema = new Schema<PageBulkExportJobDocument>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  page: { type: Schema.Types.ObjectId, ref: 'Page', required: true },
  lastUploadedPagePath: { type: String },
  uploadId: { type: String, required: true, unique: true },
  format: { type: String, enum: Object.values(PageBulkExportFormat), required: true },
  completedAt: { type: Date },
  attachment: { type: Schema.Types.ObjectId, ref: 'Attachment' },
}, { timestamps: true });

export default getOrCreateModel<PageBulkExportJobDocument, PageBulkExportJobModel>('PageBulkExportJob', pageBulkExportJobSchema);
