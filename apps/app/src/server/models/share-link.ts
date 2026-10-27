import { Schema } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import uniqueValidator from 'mongoose-unique-validator';

import { Prisma } from '~/generated/prisma/client';

import { getOrCreateModel } from '../util/mongoose-utils';

// TODO: remove mongoose model and use `prisma db push` after all models are migrated to prisma.
// Until then, use mongoose to automatically create collections and indexes when connected.
const schema = new Schema(
  {
    relatedPage: {
      type: Schema.Types.ObjectId,
      ref: 'Page',
      required: true,
      index: true,
    },
    expiredAt: { type: Date },
    description: { type: String },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);
schema.plugin(mongoosePaginate);
schema.plugin(uniqueValidator);

getOrCreateModel('ShareLink', schema);

export const extension = Prisma.defineExtension((client) => {
  return client.$extends({
    result: {
      sharelinks: {
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
        isExpired: {
          needs: { expiredAt: true },
          compute(model) {
            return () => {
              if (model.expiredAt == null) {
                return false;
              }
              return model.expiredAt.getTime() < Date.now();
            };
          },
        },
      },
    },
  });
});
