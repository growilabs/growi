import type { Types } from 'mongoose';
import { Schema } from 'mongoose';

import { Prisma } from '~/generated/prisma/client';
import { getOrCreateModel } from '~/server/util/mongoose-utils';
import type { prisma } from '~/utils/prisma';

// TODO: remove mongoose model and use `prisma db push` after all models are migrated to prisma.
// Until then, use mongoose to automatically create collections and indexes when connected.
const bookmarkSchema = new Schema(
  {
    page: { type: Schema.Types.ObjectId, ref: 'Page', index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

bookmarkSchema.index({ page: 1, user: 1 }, { unique: true });
getOrCreateModel('Bookmark', bookmarkSchema);

export const extension = Prisma.defineExtension((client) => {
  return client.$extends({
    result: {
      bookmarks: {
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
      bookmarks: {
        async countByPageId(pageId: Types.ObjectId | string): Promise<number> {
          const context =
            Prisma.getExtensionContext<typeof prisma.bookmarks>(this);
          return await context.count({
            where: {
              pageId: pageId.toString(),
            },
          });
        },

        /**
         * @return {object} key: page._id, value: bookmark count
         */
        async getPageIdToCountMap(pageIds: Types.ObjectId[]) {
          const context =
            Prisma.getExtensionContext<typeof prisma.bookmarks>(this);
          const results = await context.groupBy({
            by: ['pageId'],
            where: {
              pageId: {
                in: pageIds.map((id) => id.toString()),
              },
            },
            _count: {
              pageId: true,
            },
          });

          // convert to map
          // note: result.pageId is typed nullable because the schema allows
          // orphaned bookmarks, but the `where` filter above only matches
          // bookmarks whose pageId is one of `pageIds`, so it is never null here
          const idToCountMap: { [key: string]: number } = {};
          results.forEach((result) => {
            if (result.pageId == null) return;
            idToCountMap[result.pageId] = result._count.pageId;
          });

          return idToCountMap;
        },

        // bookmark チェック用
        async findByPageIdAndUserId(
          pageId: Types.ObjectId | string,
          userId: Types.ObjectId | string,
        ) {
          const context =
            Prisma.getExtensionContext<typeof prisma.bookmarks>(this);
          return await context.findUnique({
            where: {
              pageId_userId: {
                pageId: pageId.toString(),
                userId: userId.toString(),
              },
            },
          });
        },

        async add(
          pageId: Types.ObjectId | string,
          userId: Types.ObjectId | string,
        ) {
          const context =
            Prisma.getExtensionContext<typeof prisma.bookmarks>(this);
          // use upsert instead of create: concurrent requests for the same
          // page/user can race past the existence check in the route handler,
          // and create() would throw P2002 on the unique (pageId, userId) index
          const bookmark = await context.upsert({
            where: {
              pageId_userId: {
                pageId: pageId.toString(),
                userId: userId.toString(),
              },
            },
            create: {
              pageId: pageId.toString(),
              userId: userId.toString(),
            },
            update: {},
          });
          return bookmark;
        },

        /**
         * Remove bookmark
         * used only when removing the page
         * @param {string} pageId
         */
        async removeBookmarksByPageId(pageId: Types.ObjectId | string) {
          const context =
            Prisma.getExtensionContext<typeof prisma.bookmarks>(this);
          const result = await context.deleteMany({
            where: {
              pageId: pageId.toString(),
            },
          });
          return { deletedCount: result.count };
        },

        async removeBookmark(
          pageId: Types.ObjectId | string,
          userId: Types.ObjectId | string,
        ) {
          const context =
            Prisma.getExtensionContext<typeof prisma.bookmarks>(this);
          const data = await context.delete({
            where: {
              pageId_userId: {
                pageId: pageId.toString(),
                userId: userId.toString(),
              },
            },
          });
          return data;
        },
      },
    },
  });
});
