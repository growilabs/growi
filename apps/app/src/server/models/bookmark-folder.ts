import { objectIdUtils } from '@growi/core/dist/utils';
import type { Types } from 'mongoose';
import { Schema } from 'mongoose';

import { Prisma } from '~/generated/prisma/client';
import type {
  BookmarkFolderItems,
  IBookmarkFolder,
} from '~/interfaces/bookmark-info';
import { prisma } from '~/utils/prisma';

import { getOrCreateModel } from '../util/mongoose-utils';
import {
  BookmarkFolderForbiddenError,
  BookmarkFolderNotFoundError,
  InvalidParentBookmarkFolderError,
} from './errors';

// TODO: remove mongoose model and use `prisma db push` after all models are migrated to prisma.
// Until then, use mongoose to automatically create collections and indexes when connected.
const bookmarkFolderSchema = new Schema({
  name: { type: String },
  owner: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  parent: {
    type: Schema.Types.ObjectId,
    ref: 'BookmarkFolder',
    required: false,
  },
  bookmarks: {
    type: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Bookmark',
        required: false,
      },
    ],
    required: false,
    default: [],
  },
});

getOrCreateModel('BookmarkFolder', bookmarkFolderSchema);

export const extension = Prisma.defineExtension((client) => {
  return client.$extends({
    result: {
      bookmarkfolders: {
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
      bookmarkfolders: {
        async createByParameters(params: IBookmarkFolder) {
          const context =
            Prisma.getExtensionContext<typeof prisma.bookmarkfolders>(this);
          const { name, owner, parent } = params;
          const ownerId = owner.toString();

          if (parent == null) {
            return context.create({
              data: { name, ownerId },
            });
          }

          const isParentFolderIdValid = objectIdUtils.isValidObjectId(
            parent as string,
          );
          if (!isParentFolderIdValid) {
            throw new InvalidParentBookmarkFolderError(
              'Parent folder id is invalid',
            );
          }
          const parentFolder = await context.findUnique({
            where: { id: parent.toString() },
          });
          if (parentFolder == null) {
            throw new InvalidParentBookmarkFolderError(
              'Parent folder not found',
            );
          }
          return context.create({
            data: {
              name,
              ownerId,
              parentId: parentFolder.id,
            },
          });
        },

        async deleteFolderAndChildren(
          bookmarkFolderId: Types.ObjectId | string,
          ownerId?: Types.ObjectId | string,
        ): Promise<{ deletedCount: number }> {
          const context =
            Prisma.getExtensionContext<typeof prisma.bookmarkfolders>(this);
          const bookmarkFolder = await context.findUnique({
            where: { id: bookmarkFolderId.toString() },
          });

          if (ownerId != null) {
            if (bookmarkFolder == null) {
              throw new BookmarkFolderNotFoundError(
                'Bookmark folder not found',
              );
            }
            if (bookmarkFolder.ownerId !== ownerId.toString()) {
              throw new BookmarkFolderForbiddenError('Forbidden');
            }
          }

          let deletedCount = 0;
          if (bookmarkFolder != null) {
            if (bookmarkFolder.bookmarkIds.length > 0) {
              await context.deleteMany({
                where: { id: { in: bookmarkFolder.bookmarkIds } },
              });
            }

            const childFolders = await context.findMany({
              where: { parentId: bookmarkFolder.id },
            });
            await Promise.all(
              childFolders.map(async (child) => {
                const deletedChildFolder =
                  await context.deleteFolderAndChildren(child.id);
                deletedCount += deletedChildFolder.deletedCount;
              }),
            );

            const deletedChildren = await context.deleteMany({
              where: { parentId: bookmarkFolder.id },
            });
            deletedCount += deletedChildren.count + 1;
            await context.delete({ where: { id: bookmarkFolder.id } });
          }
          return { deletedCount };
        },

        async updateBookmarkFolder(
          bookmarkFolderId: string,
          name: string,
          parentId: string | null,
          childFolder: BookmarkFolderItems[],
        ) {
          const context =
            Prisma.getExtensionContext<typeof prisma.bookmarkfolders>(this);
          const parentFolder = parentId
            ? await context.findUnique({ where: { id: parentId } })
            : null;

          // Maximum folder hierarchy of 2 levels
          // If the destination folder (parentFolder) has a parent, the source folder cannot be moved because the destination folder hierarchy is already 2.
          // If the drop source folder has child folders, the drop source folder cannot be moved because the drop source folder hierarchy is already 2.
          if (parentId != null) {
            if (parentFolder?.parentId != null) {
              throw new Error('Update bookmark folder failed');
            }
            if (childFolder.length !== 0) {
              throw new Error('Update bookmark folder failed');
            }
          }

          const updated = await context.update({
            where: { id: bookmarkFolderId },
            data: { name, parentId: parentFolder?.id ?? null },
          });
          if (updated == null) {
            throw new Error('Update bookmark folder failed');
          }
          return updated;
        },

        async insertOrUpdateBookmarkedPage(
          pageId: string,
          userId: string,
          folderId: string | null,
        ) {
          const context =
            Prisma.getExtensionContext<typeof prisma.bookmarkfolders>(this);
          // Find bookmark
          const bookmarkedPage = await prisma.bookmarks.findUnique({
            where: {
              pageId_userId: {
                pageId,
                userId,
              },
            },
          });

          if (bookmarkedPage == null) {
            return null;
          }

          // Remove existing bookmark in bookmark folder
          await client.$runCommandRaw({
            update: 'bookmarkfolders',
            updates: [
              {
                q: { owner: { $oid: userId } },
                u: {
                  $pull: {
                    bookmarks: { $oid: bookmarkedPage._id },
                  },
                },
                multi: true,
              },
            ],
          });

          if (folderId == null) {
            return null;
          }

          // Insert bookmark into bookmark folder
          await client.$runCommandRaw({
            update: 'bookmarkfolders',
            updates: [
              {
                q: {
                  _id: { $oid: folderId },
                  owner: { $oid: userId },
                },
                u: {
                  $addToSet: {
                    bookmarks: { $oid: bookmarkedPage._id },
                  },
                },
                multi: false,
                upsert: true,
              },
            ],
          });

          return context.findUnique({
            where: { id: folderId },
          });
        },

        async updateBookmark(pageId: string, status: boolean, userId: string) {
          // If isBookmarked
          if (status) {
            const context =
              Prisma.getExtensionContext<typeof prisma.bookmarkfolders>(this);
            const bookmarkedPage = await prisma.bookmarks.findUnique({
              where: {
                pageId_userId: {
                  pageId,
                  userId,
                },
              },
            });
            const bookmarkFolder = await context.findFirst({
              where: {
                ownerId: userId,
                bookmarkIds: {
                  hasSome: bookmarkedPage ? [bookmarkedPage._id] : [],
                },
              },
            });
            if (bookmarkFolder != null && bookmarkedPage != null) {
              await client.$runCommandRaw({
                update: 'bookmarkfolders',
                updates: [
                  {
                    q: {
                      _id: { $oid: bookmarkFolder.id },
                      owner: { $oid: userId },
                    },
                    u: {
                      $pull: {
                        bookmarks: { $oid: bookmarkedPage._id },
                      },
                    },
                    multi: false,
                  },
                ],
              });
            }

            if (bookmarkedPage) {
              await prisma.bookmarks.delete({
                where: {
                  id: bookmarkedPage.id,
                },
              });
            }
            return bookmarkFolder;
          }
          // else , Add bookmark
          await prisma.bookmarks.create({
            data: {
              pageId,
              userId,
            },
          });
          return null;
        },
      },
    },
  });
});
