import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import mongoose from 'mongoose';

import getPageModel from '~/server/models/page';
import { createBatchStream } from '~/server/util/batch-stream';
import {
  getModelSafely,
  getMongoUri,
  mongoOptions,
} from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

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
      const updates = pages.map((page) => ({
        q: {
          $and: [{ path: page.path }, { pageId: { $exists: false } }],
        },
        u: [
          { $unset: ['path'] },
          { $set: { pageId: { $oid: page._id.toString() } } },
        ],
        multi: true,
      }));

      await prisma.$runCommandRaw({
        update: 'revisions',
        updates,
      });

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
      const updates = pages.map((page) => ({
        q: {
          $and: [
            { pageId: { $oid: page._id.toString() } },
            { path: { $exists: false } },
          ],
        },
        u: [{ $unset: ['pageId'] }, { $set: { path: page.path } }],
        multi: true,
      }));

      await prisma.$runCommandRaw({
        update: 'revisions',
        updates,
      });

      callback();
    },
    final(callback) {
      callback();
    },
  });

  await pipeline(pagesStream, batchStrem, migratePagesStream);

  logger.info('Migration down has successfully applied');
}
