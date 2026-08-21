import { allOrigin } from '@growi/core';
import type { HasObjectId, Origin } from '@growi/core/dist/interfaces';
import type { Types } from 'mongoose';
import { Schema } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';

import { Prisma } from '~/generated/prisma/client';
import loggerFactory from '~/utils/logger';
import type { prisma } from '~/utils/prisma';

import { getOrCreateModel } from '../util/mongoose-utils';
import type { PageDocument } from './page';

const logger = loggerFactory('growi:models:revision');

// Use this to allow empty strings to pass the `required` validator
Schema.Types.String.checkRequired((v) => typeof v === 'string');

const revisionSchema = new Schema(
  {
    // The type of pageId is always converted to String at server startup
    // Refer to this method (/src/server/service/normalize-data/convert-revision-page-id-to-string.ts) to change the pageId type
    pageId: {
      type: Schema.Types.ObjectId,
      ref: 'Page',
      required: true,
      index: true,
    },
    body: {
      type: String,
      required: true,
      get: (data) => {
        // replace CR/CRLF to LF above v3.1.5
        // see https://github.com/growilabs/growi/issues/463
        return data ? data.replace(/\r\n?/g, '\n') : '';
      },
    },
    format: { type: String, default: 'markdown' },
    author: { type: Schema.Types.ObjectId, ref: 'User' },
    hasDiffToPrev: { type: Boolean },
    origin: { type: String, enum: allOrigin },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);
revisionSchema.plugin(mongoosePaginate);
revisionSchema.index({ author: 1, createdAt: -1 });

getOrCreateModel('Revision', revisionSchema);

export const extension = Prisma.defineExtension((client) => {
  return client.$extends({
    result: {
      revisions: {
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
        // replace CR/CRLF to LF above v3.1.5
        // see https://github.com/growilabs/growi/issues/463
        body: {
          needs: { body: true },
          compute(model) {
            return model.body ? model.body.replace(/\r\n?/g, '\n') : '';
          },
        },
      },
    },
    model: {
      revisions: {
        async updateRevisionListByPageId(
          pageId: Types.ObjectId | string,
          updateData: Prisma.revisionsUncheckedUpdateManyInput,
        ): Promise<void> {
          // Check pageId for safety
          if (pageId == null) {
            throw new Error('Error: pageId is required');
          }
          const context =
            Prisma.getExtensionContext<typeof prisma.revisions>(this);
          await context.updateMany({
            where: { pageId: pageId.toString() },
            data: updateData,
          });
        },
        prepareRevision(
          pageData: PageDocument,
          body: string,
          previousBody: string | null,
          user: HasObjectId,
          origin?: Origin,
          options: { format: string } = { format: 'markdown' },
        ): Prisma.revisionsUncheckedCreateInput {
          if (user._id == null) {
            throw new Error('user should have _id');
          }
          if (pageData._id == null) {
            throw new Error('pageData should have _id');
          }

          return {
            pageId: pageData._id.toString(),
            body: body,
            format: options.format,
            authorId: user._id,
            origin: origin,
            hasDiffToPrev:
              pageData.revision != null ? body !== previousBody : undefined,
          };
        },
      },
    },
  });
});
