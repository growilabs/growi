import { Schema } from 'mongoose';

import { Prisma } from '~/generated/prisma/client';
import { getOrCreateModel } from '~/server/util/mongoose-utils';
import type { prisma } from '~/utils/prisma';

// TODO: remove mongoose model and use `prisma db push` after all models are migrated to prisma.
// Until then, use mongoose to automatically create collections and indexes when connected.
const commentSchema = new Schema(
  {
    page: { type: Schema.Types.ObjectId, ref: 'Page', index: true },
    creator: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    revision: { type: Schema.Types.ObjectId, ref: 'Revision', index: true },
    comment: { type: String, required: true },
    commentPosition: { type: Number, default: -1 },
    replyTo: { type: Schema.Types.ObjectId },
  },
  {
    timestamps: true,
  },
);
getOrCreateModel('Comment', commentSchema);

export const extension = Prisma.defineExtension((client) => {
  return client.$extends({
    result: {
      comments: {
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
    model: {
      comments: {
        add(
          pageId: string,
          creatorId: string,
          revisionId: string,
          comment: string,
          commentPosition: number,
          replyToId?: string | null,
        ) {
          const context =
            Prisma.getExtensionContext<typeof prisma.comments>(this);
          return context.create({
            data: {
              pageId,
              creatorId,
              revisionId,
              comment,
              commentPosition,
              replyToId,
            },
          });
        },

        findCommentsByPageId(
          pageId: string,
          options: Omit<Prisma.commentsFindManyArgs, 'where'>,
        ) {
          const context =
            Prisma.getExtensionContext<typeof prisma.comments>(this);
          return context.findMany({
            where: { pageId },
            orderBy: {
              createdAt: 'desc',
              ...options.orderBy,
            },
            ...options,
          });
        },

        findCommentsByRevisionId(
          revisionId: string,
          options: Omit<Prisma.commentsFindManyArgs, 'where'>,
        ) {
          const context =
            Prisma.getExtensionContext<typeof prisma.comments>(this);
          return context.findMany({
            where: { revisionId },
            orderBy: {
              createdAt: 'desc',
              ...options.orderBy,
            },
            ...options,
          });
        },

        async findCreatorsByPage(pageId: string) {
          const context =
            Prisma.getExtensionContext<typeof prisma.comments>(this);
          const creators = await context.findMany({
            where: { pageId },
            select: { creator: true },
            distinct: ['creatorId'],
          });
          return creators
            .map((c) => c.creator)
            .filter((c): c is Exclude<typeof c, null> => c !== null);
        },

        countCommentByPageId(pageId: string) {
          const context =
            Prisma.getExtensionContext<typeof prisma.comments>(this);
          return context.count({
            where: { pageId },
          });
        },

        async removeWithReplies(commentId: string) {
          const context =
            Prisma.getExtensionContext<typeof prisma.comments>(this);
          await client.$transaction([
            context.deleteMany({
              where: {
                replyToId: commentId,
              },
            }),
            context.delete({
              where: {
                id: commentId,
              },
            }),
          ]);
        },
      },
    },
  });
});
