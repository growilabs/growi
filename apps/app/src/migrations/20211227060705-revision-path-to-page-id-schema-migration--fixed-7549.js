import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import mongoose from 'mongoose';

import getPageModel from '~/server/models/page';
import { Revision } from '~/server/models/revision';
import { createBatchStream } from '~/server/util/batch-stream';
import {
  getModelSafely,
  getMongoUri,
  mongoOptions,
} from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:migrate:revision-path-to-page-id-schema-migration--fixed-7549',
);

const LIMIT = 300;

module.exports = {
  // path => pageId
  async up(db, client) {
    await mongoose.connect(getMongoUri(), mongoOptions);
    const Page = getModelSafely('Page') || getPageModel();

    const pagesStream = await Page.find(
      { revision: { $ne: null } },
      { _id: 1, path: 1 },
    ).cursor({ batch_size: LIMIT });
    const batchStrem = createBatchStream(LIMIT);

    const migratePagesStream = new Writable({
      objectMode: true,
      async write(pages, _encoding, callback) {
        const updateManyOperations = pages.map((page) => {
          return {
            updateMany: {
              filter: {
                $and: [{ path: page.path }, { pageId: { $exists: false } }],
              },
              update: [
                {
                  $unset: ['path'],
                },
                {
                  $set: { pageId: page._id },
                },
              ],
            },
          };
        });

        await Revision.bulkWrite(updateManyOperations, { strict: false });

        callback();
      },
      final(callback) {
        callback();
      },
    });

    await pipeline(pagesStream, batchStrem, migratePagesStream);

    logger.info('Migration has successfully applied');
  },

  // pageId => path
  async down(db, client) {
    await mongoose.connect(getMongoUri(), mongoOptions);
    const Page = getModelSafely('Page') || getPageModel();

    const pagesStream = await Page.find(
      { revision: { $ne: null } },
      { _id: 1, path: 1 },
    ).cursor({ batch_size: LIMIT });
    const batchStrem = createBatchStream(LIMIT);

    const migratePagesStream = new Writable({
      objectMode: true,
      async write(pages, _encoding, callback) {
        const updateManyOperations = pages.map((page) => {
          return {
            updateMany: {
              filter: {
                $and: [{ pageId: page._id }, { path: { $exists: false } }],
              },
              update: [
                {
                  $unset: ['pageId'],
                },
                {
                  $set: { path: page.path },
                },
              ],
            },
          };
        });

        await Revision.bulkWrite(updateManyOperations, { strict: false });

        callback();
      },
      final(callback) {
        callback();
      },
    });

    await pipeline(pagesStream, batchStrem, migratePagesStream);

    logger.info('Migration down has successfully applied');
  },
};
