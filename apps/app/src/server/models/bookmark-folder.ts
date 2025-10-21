import type { IPageHasId } from '@growi/core';
import { objectIdUtils } from '@growi/core/dist/utils';
import type { Document, Model, Types } from 'mongoose';
import monggoose, { Schema } from 'mongoose';

import type {
  BookmarkFolderItems,
  IBookmarkFolder,
} from '~/interfaces/bookmark-info';

import loggerFactory from '../../utils/logger';
import { getOrCreateModel } from '../util/mongoose-utils';
import { InvalidParentBookmarkFolderError } from './errors';

const logger = loggerFactory('growi:models:bookmark-folder');
const Bookmark = monggoose.model('Bookmark');

export interface BookmarkFolderDocument extends Document {
  _id: Types.ObjectId;
  name: string;
  owner: Types.ObjectId;
  parent?: Types.ObjectId | undefined;
  bookmarks?: Types.ObjectId[];
  childFolder?: BookmarkFolderDocument[];
}

export interface BookmarkFolderModel extends Model<BookmarkFolderDocument> {
  createByParameters(params: IBookmarkFolder): Promise<BookmarkFolderDocument>;
  deleteFolderAndChildren(
    bookmarkFolderId: Types.ObjectId | string,
  ): Promise<{ deletedCount: number }>;
  updateBookmarkFolder(
    bookmarkFolderId: string,
    name: string,
    parent: string | null,
    childFolder: BookmarkFolderItems[],
  ): Promise<BookmarkFolderDocument>;
  insertOrUpdateBookmarkedPage(
    pageId: IPageHasId,
    userId: Types.ObjectId | string,
    folderId: string | null,
  ): Promise<BookmarkFolderDocument | null>;
  updateBookmark(
    pageId: Types.ObjectId | string,
    status: boolean,
    userId: Types.ObjectId | string,
  ): Promise<BookmarkFolderDocument | null>;
}

const bookmarkFolderSchema = new Schema<
  BookmarkFolderDocument,
  BookmarkFolderModel
>(
  {
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
  },
  {
    toObject: { virtuals: true },
  },
);

bookmarkFolderSchema.virtual('childFolder', {
  ref: 'BookmarkFolder',
  localField: '_id',
  foreignField: 'parent',
});

bookmarkFolderSchema.statics.createByParameters = async function (
  params: IBookmarkFolder,
): Promise<BookmarkFolderDocument> {
  const { name, owner, parent } = params;
  let bookmarkFolder: BookmarkFolderDocument;

  if (parent == null) {
    bookmarkFolder = await this.create({ name, owner });
  } else {
    // Check if parent folder id is valid and parent folder exists
    const isParentFolderIdValid = objectIdUtils.isValidObjectId(
      parent as string,
    );

    if (!isParentFolderIdValid) {
      throw new InvalidParentBookmarkFolderError('Parent folder id is invalid');
    }
    const parentFolder = await this.findById(parent);
    if (parentFolder == null) {
      throw new InvalidParentBookmarkFolderError('Parent folder not found');
    }
    bookmarkFolder = await this.create({
      name,
      owner,
      parent: parentFolder._id,
    });
  }

  return bookmarkFolder;
};

bookmarkFolderSchema.statics.deleteFolderAndChildren = async function (
  bookmarkFolderId: Types.ObjectId | string,
): Promise<{ deletedCount: number }> {
  const bookmarkFolder = await this.findById(bookmarkFolderId);
  // Delete parent and all children folder
  let deletedCount = 0;
  if (bookmarkFolder != null) {
    // Delete Bookmarks
    const bookmarks = bookmarkFolder?.bookmarks;
    if (bookmarks && bookmarks.length > 0) {
      await Bookmark.deleteMany({ _id: { $in: bookmarks } });
    }
    // Delete all child recursively and update deleted count
    const childFolders = await this.find({ parent: bookmarkFolder._id });
    await Promise.all(
      childFolders.map(async (child) => {
        const deletedChildFolder = await this.deleteFolderAndChildren(
          child._id,
        );
        deletedCount += deletedChildFolder.deletedCount;
      }),
    );
    const deletedChild = await this.deleteMany({ parent: bookmarkFolder._id });
    deletedCount += deletedChild.deletedCount + 1;
    bookmarkFolder.delete();
  }
  return { deletedCount };
};

bookmarkFolderSchema.statics.updateBookmarkFolder = async function (
  bookmarkFolderId: string,
  name: string,
  parentId: string | null,
  childFolder: BookmarkFolderItems[],
): Promise<BookmarkFolderDocument> {
  const updateFields: { name: string; parent: Types.ObjectId | null } = {
    name: '',
    parent: null,
  };

  updateFields.name = name;
  const parentFolder = parentId ? await this.findById(parentId) : null;
  updateFields.parent = parentFolder?._id ?? null;

  // Maximum folder hierarchy of 2 levels
  // If the destination folder (parentFolder) has a parent, the source folder cannot be moved because the destination folder hierarchy is already 2.
  // If the drop source folder has child folders, the drop source folder cannot be moved because the drop source folder hierarchy is already 2.
  if (parentId != null) {
    if (parentFolder?.parent != null) {
      throw new Error('Update bookmark folder failed');
    }
    if (childFolder.length !== 0) {
      throw new Error('Update bookmark folder failed');
    }
  }

  const bookmarkFolder = await this.findByIdAndUpdate(
    bookmarkFolderId,
    { $set: updateFields },
    { new: true },
  );
  if (bookmarkFolder == null) {
    throw new Error('Update bookmark folder failed');
  }
  return bookmarkFolder;
};

bookmarkFolderSchema.statics.insertOrUpdateBookmarkedPage = async function (
  pageId: IPageHasId,
  userId: Types.ObjectId | string,
  folderId: string | null,
): Promise<BookmarkFolderDocument | null> {
  // Find bookmark
  const bookmarkedPage = await Bookmark.findOne(
    { page: pageId, user: userId },
    { new: true, upsert: true },
  );

  // Remove existing bookmark in bookmark folder
  await this.updateMany(
    { owner: userId },
    { $pull: { bookmarks: bookmarkedPage?._id } },
  );
  if (folderId == null) {
    return null;
  }

  // Insert bookmark into bookmark folder
  const bookmarkFolder = await this.findByIdAndUpdate(
    { _id: folderId, owner: userId },
    { $addToSet: { bookmarks: bookmarkedPage } },
    { new: true, upsert: true },
  );

  return bookmarkFolder;
};

bookmarkFolderSchema.statics.updateBookmark = async function (
  pageId: Types.ObjectId | string,
  status: boolean,
  userId: Types.ObjectId | string,
): Promise<BookmarkFolderDocument | null> {
  // If isBookmarked
  if (status) {
    const bookmarkedPage = await Bookmark.findOne({
      page: pageId,
      user: userId,
    });
    const bookmarkFolder = await this.findOne({
      owner: userId,
      bookmarks: { $in: [bookmarkedPage?._id] },
    });
    if (bookmarkFolder != null) {
      await this.updateOne(
        { owner: userId, _id: bookmarkFolder._id },
        { $pull: { bookmarks: bookmarkedPage?._id } },
      );
    }

    if (bookmarkedPage) {
      await bookmarkedPage.delete();
    }
    return bookmarkFolder;
  }
  // else , Add bookmark
  await Bookmark.create({ page: pageId, user: userId });
  return null;
};
export default getOrCreateModel<BookmarkFolderDocument, BookmarkFolderModel>(
  'BookmarkFolder',
  bookmarkFolderSchema,
);
