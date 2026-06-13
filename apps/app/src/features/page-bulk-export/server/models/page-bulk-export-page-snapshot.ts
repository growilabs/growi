import { type Document, type Model, Schema } from 'mongoose';

import { getOrCreateModel } from '~/server/util/mongoose-utils.js';

import type { IPageBulkExportPageSnapshot } from '../../interfaces/page-bulk-export.js';

export interface PageBulkExportPageSnapshotDocument
  extends IPageBulkExportPageSnapshot,
    Document {}

export type PageBulkExportPageSnapshotModel =
  Model<PageBulkExportPageSnapshotDocument>;

const pageBulkExportPageInfoSchema =
  new Schema<PageBulkExportPageSnapshotDocument>(
    {
      pageBulkExportJob: {
        type: Schema.Types.ObjectId,
        ref: 'PageBulkExportJob',
        required: true,
      },
      path: { type: String, required: true },
      revision: {
        type: Schema.Types.ObjectId,
        ref: 'Revision',
        required: true,
      },
    },
    { timestamps: true },
  );

export default getOrCreateModel<
  PageBulkExportPageSnapshotDocument,
  PageBulkExportPageSnapshotModel
>('PageBulkExportPageSnapshot', pageBulkExportPageInfoSchema);
