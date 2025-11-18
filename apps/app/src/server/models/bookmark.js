/* eslint-disable no-return-await */

import mongoose from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import uniqueValidator from 'mongoose-unique-validator';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:models:bookmark');

const ObjectId = mongoose.Schema.Types.ObjectId;

/** @param {import('~/server/crowi').default} crowi Crowi instance */
const factory = (crowi) => {
  const bookmarkEvent = crowi.event('bookmark');

  let bookmarkSchema = null;

  bookmarkSchema = new mongoose.Schema(
    {
      page: { type: ObjectId, ref: 'Page', index: true },
      user: { type: ObjectId, ref: 'User', index: true },
    },
    {
      timestamps: { createdAt: true, updatedAt: false },
    },
  );
  bookmarkSchema.index({ page: 1, user: 1 }, { unique: true });
  bookmarkSchema.plugin(mongoosePaginate);
  bookmarkSchema.plugin(uniqueValidator);

  bookmarkSchema.statics.countByPageId = async function (pageId) {
    return await this.count({ page: pageId });
  };

  /**
   * @return {object} key: page._id, value: bookmark count
   */
  bookmarkSchema.statics.getPageIdToCountMap = async function (pageIds) {
    const results = await this.aggregate()
      .match({ page: { $in: pageIds } })
      .group({ _id: '$page', count: { $sum: 1 } });

    // convert to map
    const idToCountMap = {};
    results.forEach((result) => {
      idToCountMap[result._id] = result.count;
    });

    return idToCountMap;
  };

  // bookmark チェック用
  bookmarkSchema.statics.findByPageIdAndUserId = function (pageId, userId) {
    return new Promise((resolve, reject) => {
      return this.findOne({ page: pageId, user: userId }, (err, doc) => {
        if (err) {
          return reject(err);
        }

        return resolve(doc);
      });
    });
  };

  bookmarkSchema.statics.add = async function (page, user) {
    // biome-ignore lint/complexity/noUselessThisAlias: ignore
    const Bookmark = this;

    const newBookmark = new Bookmark({ page, user });

    try {
      const bookmark = await newBookmark.save();
      bookmarkEvent.emit('create', page._id);
      return bookmark;
    } catch (err) {
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
  bookmarkSchema.statics.removeBookmarksByPageId = async function (pageId) {
    // biome-ignore lint/complexity/noUselessThisAlias: ignore
    const Bookmark = this;

    try {
      const data = await Bookmark.remove({ page: pageId });
      bookmarkEvent.emit('delete', pageId);
      return data;
    } catch (err) {
      logger.debug('Bookmark.remove failed (removeBookmarkByPage)', err);
      throw err;
    }
  };

  bookmarkSchema.statics.removeBookmark = async function (pageId, user) {
    // biome-ignore lint/complexity/noUselessThisAlias: ignore
    const Bookmark = this;

    try {
      const data = await Bookmark.findOneAndRemove({ page: pageId, user });
      bookmarkEvent.emit('delete', pageId);
      return data;
    } catch (err) {
      logger.debug('Bookmark.findOneAndRemove failed', err);
      throw err;
    }
  };

  return mongoose.model('Bookmark', bookmarkSchema);
};

export default factory;
