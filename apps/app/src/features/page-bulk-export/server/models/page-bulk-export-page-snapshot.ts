import { Schema } from 'mongoose';

import { Prisma } from '~/generated/prisma/client';
import { getOrCreateModel } from '~/server/util/mongoose-utils';

// TODO: remove mongoose model and use `prisma db push` after all models are migrated to prisma.
// Until then, use mongoose to automatically create collections and indexes when connected.
const pageBulkExportPageSnapshotSchema = new Schema({
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
});

getOrCreateModel(
  'PageBulkExportPageSnapshot',
  pageBulkExportPageSnapshotSchema,
);

export const extension = Prisma.defineExtension((client) => {
  return client.$extends({
    result: {
      pagebulkexportpagesnapshots: {
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
