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

/**
 * Connect only when disconnected. Under the migrate-mongo CLI nothing has opened
 * a mongoose connection yet, so this connects as before; when a caller already
 * holds one (the integration test, which is bound to a per-worker database whose
 * name getMongoUri() does not know), re-connecting would throw
 * "Can't call `openUri()` on an active connection with different connection strings".
 * see: https://mongoosejs.com/docs/api/connection.html#connection_Connection-readyState
 */
async function connectIfDisconnected() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(getMongoUri(), mongoOptions);
  }
}

export async function up(db, client) {
  await connectIfDisconnected();
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
  await connectIfDisconnected();
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
