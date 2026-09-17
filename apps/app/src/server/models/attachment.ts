import { createHash } from 'node:crypto';
import { addSeconds } from 'date-fns/addSeconds';
import { Schema } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import uniqueValidator from 'mongoose-unique-validator';
import path from 'pathe';

import type { attachments } from '~/generated/prisma/client';
import { Prisma } from '~/generated/prisma/client';
import loggerFactory from '~/utils/logger';
import type { prisma } from '~/utils/prisma';

import { AttachmentType } from '../interfaces/attachment';
import { getOrCreateModel } from '../util/mongoose-utils';

const _logger = loggerFactory('growi:models:attachment');

function generateFileHash(fileName: string) {
  const hash = createHash('md5');
  hash.update(`${fileName}_${Date.now()}`);

  return hash.digest('hex');
}

// TODO: remove mongoose model and use `prisma db push` after all models are migrated to prisma.
// Until then, use mongoose to automatically create collections and indexes when connected.
const attachmentSchema = new Schema(
  {
    page: { type: Schema.Types.ObjectId, ref: 'Page', index: true },
    creator: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    filePath: { type: String }, // DEPRECATED: remains for backward compatibility for v3.3.x or below
    fileName: { type: String, required: true, unique: true },
    fileFormat: { type: String, required: true },
    fileSize: { type: Number, default: 0 },
    originalName: { type: String },
    temporaryUrlCached: { type: String },
    temporaryUrlExpiredAt: { type: Date },
    attachmentType: {
      type: String,
      enum: AttachmentType,
      required: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);
attachmentSchema.plugin(uniqueValidator);
attachmentSchema.plugin(mongoosePaginate);

getOrCreateModel('Attachment', attachmentSchema);

/**
 * Data for an Attachment that has not been persisted yet: built up-front so
 * its `fileName`/`pageId` are available to `FileUploader#uploadAttachment`
 * before the row is created, then passed to `prisma.attachments.create()`
 * once the upload succeeds. Keeping upload-before-create means a failed
 * upload never leaves an orphaned Attachment row.
 */
export type AttachmentDraft = Pick<
  attachments,
  | 'pageId'
  | 'creatorId'
  | 'filePath'
  | 'fileName'
  | 'fileFormat'
  | 'fileSize'
  | 'originalName'
  | 'attachmentType'
>;

/**
 * An attachment row as returned by the extended prisma client: the base
 * schema fields plus the computed `_id`/`__v`/`filePathProxied`/
 * `downloadPathProxied`/`getValidTemporaryUrl` added by `result.attachments`
 * below. The plain generated `attachments` type does not carry these --
 * only a query made through `prisma` (with this extension applied) does.
 */
export type AttachmentWithComputed = NonNullable<
  Awaited<ReturnType<typeof prisma.attachments.findUnique>>
>;

export const extension = Prisma.defineExtension((client) => {
  return client.$extends({
    result: {
      attachments: {
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
        filePathProxied: {
          needs: { id: true },
          compute(model) {
            return `/attachment/${model.id}`;
          },
        },
        downloadPathProxied: {
          needs: { id: true },
          compute(model) {
            return `/download/${model.id}`;
          },
        },
        getValidTemporaryUrl: {
          needs: { temporaryUrlCached: true, temporaryUrlExpiredAt: true },
          compute(model) {
            return (): string | null | undefined => {
              if (model.temporaryUrlExpiredAt == null) {
                return null;
              }
              // return null when expired url
              if (model.temporaryUrlExpiredAt.getTime() < Date.now()) {
                return null;
              }
              return model.temporaryUrlCached;
            };
          },
        },
      },
    },
    model: {
      attachments: {
        createWithoutSave(
          pageId: string | null,
          user: { _id: string },
          originalName: string,
          fileFormat: string,
          fileSize: number,
          attachmentType: AttachmentType,
        ) {
          const extname = path.extname(originalName);
          let fileName = generateFileHash(originalName);
          if (extname.length > 1) {
            // ignore if empty or '.' only
            fileName = `${fileName}${extname}`;
          }

          return {
            pageId,
            creatorId: user._id,
            filePath: null,
            fileName,
            fileFormat,
            fileSize,
            originalName,
            attachmentType,
          };
        },
        cashTemporaryUrlByProvideSec(
          attachmentId: string,
          temporaryUrl: string,
          lifetimeSec: number,
        ): Promise<attachments> {
          const context =
            Prisma.getExtensionContext<typeof prisma.attachments>(this);
          return context.update({
            where: { id: attachmentId },
            data: {
              temporaryUrlCached: temporaryUrl,
              temporaryUrlExpiredAt: addSeconds(new Date(), lifetimeSec),
            },
          });
        },
      },
    },
  });
});
