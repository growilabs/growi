import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import mongoose from 'mongoose';

import getPageModel from '~/server/models/page.js';
import { Revision } from '~/server/models/revision.js';
import { createBatchStream } from '~/server/util/batch-stream.js';
import {
  getModelSafely,
  getMongoUri,
  mongoOptions,
} from '~/server/util/mongoose-utils.js';
import loggerFactory from '~/utils/logger/index.js';

const logger = loggerFactory(
  'growi:migrate:revision-path-to-page-id-schema-migration--fixed-8998',
);

const LIMIT = 300;

export async function up(db, client) {
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
}

export async function down(db, client) {
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
}
