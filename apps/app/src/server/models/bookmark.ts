import type { Document, Model, Types } from 'mongoose';
import { Schema } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import uniqueValidator from 'mongoose-unique-validator';

import type { IBookmark } from '~/interfaces/bookmark-info';
import loggerFactory from '~/utils/logger';

import type Crowi from '../crowi';
import { getOrCreateModel } from '../util/mongoose-utils';

const logger = loggerFactory('growi:models:bookmark');

export interface BookmarkDocument extends IBookmark, Document {
  _id: Types.ObjectId;
  page: Types.ObjectId;
  user: Types.ObjectId;
  createdAt: Date;
}

export interface BookmarkModel extends Model<BookmarkDocument> {
  countByPageId(pageId: Types.ObjectId | string): Promise<number>;
  getPageIdToCountMap(
    pageIds: Types.ObjectId[],
  ): Promise<{ [key: string]: number }>;
  findByPageIdAndUserId(
    pageId: Types.ObjectId | string,
    userId: Types.ObjectId | string,
  ): Promise<BookmarkDocument | null>;
  add(
    page: Types.ObjectId | string,
    user: Types.ObjectId | string,
  ): Promise<BookmarkDocument>;
  removeBookmarksByPageId(
    pageId: Types.ObjectId | string,
  ): Promise<{ deletedCount: number }>;
  removeBookmark(
    pageId: Types.ObjectId | string,
    user: Types.ObjectId | string,
  ): Promise<BookmarkDocument | null>;
}

const factory = (crowi: Crowi) => {
  const bookmarkEvent = crowi.event('bookmark');

  const bookmarkSchema = new Schema<BookmarkDocument, BookmarkModel>(
    {
      page: { type: Schema.Types.ObjectId, ref: 'Page', index: true },
      user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    },
    {
      timestamps: { createdAt: true, updatedAt: false },
    },
  );

  bookmarkSchema.index({ page: 1, user: 1 }, { unique: true });
  bookmarkSchema.plugin(mongoosePaginate);
  bookmarkSchema.plugin(uniqueValidator);

  bookmarkSchema.statics.countByPageId = async function (
    pageId: Types.ObjectId | string,
  ): Promise<number> {
    return await this.countDocuments({ page: pageId });
  };

  /**
   * @return {object} key: page._id, value: bookmark count
   */
  bookmarkSchema.statics.getPageIdToCountMap = async function (
    pageIds: Types.ObjectId[],
  ): Promise<{ [key: string]: number }> {
    const results = await this.aggregate()
      .match({ page: { $in: pageIds } })
      .group({ _id: '$page', count: { $sum: 1 } });

    // convert to map
    const idToCountMap: { [key: string]: number } = {};
    results.forEach((result) => {
      idToCountMap[result._id] = result.count;
    });

    return idToCountMap;
  };

  // bookmark チェック用
  bookmarkSchema.statics.findByPageIdAndUserId = async function (
    pageId: Types.ObjectId | string,
    userId: Types.ObjectId | string,
  ): Promise<BookmarkDocument | null> {
    return await this.findOne({ page: pageId, user: userId });
  };

  bookmarkSchema.statics.add = async function (
    page: Types.ObjectId | string,
    user: Types.ObjectId | string,
  ): Promise<BookmarkDocument> {
    const newBookmark = new this({ page, user });

    try {
      const bookmark = await newBookmark.save();
      bookmarkEvent.emit('create', page);
      return bookmark;
    } catch (err: any) {
      if (err.code === 11000) {
        // duplicate key (dummy response of new object)
        return newBookmark;
      }
      logger.debug('Bookmark.save failed', err);
      throw err;
    }
  };

  /**
   * Remove bookmark
   * used only when removing the page
   * @param {string} pageId
   */
  bookmarkSchema.statics.removeBookmarksByPageId = async function (
    pageId: Types.ObjectId | string,
  ): Promise<{ deletedCount: number }> {
    try {
      const result = await this.deleteMany({ page: pageId });
      bookmarkEvent.emit('delete', pageId);
      return { deletedCount: result.deletedCount ?? 0 };
    } catch (err) {
      logger.debug('Bookmark.remove failed (removeBookmarkByPage)', err);
      throw err;
    }
  };

  bookmarkSchema.statics.removeBookmark = async function (
    pageId: Types.ObjectId | string,
    user: Types.ObjectId | string,
  ): Promise<BookmarkDocument | null> {
    try {
      const data = await this.findOneAndDelete({ page: pageId, user });
      bookmarkEvent.emit('delete', pageId);
      return data;
    } catch (err) {
      logger.debug('Bookmark.findOneAndRemove failed', err);
      throw err;
    }
  };

  return getOrCreateModel<BookmarkDocument, BookmarkModel>(
    'Bookmark',
    bookmarkSchema,
  );
};

export default factory;
