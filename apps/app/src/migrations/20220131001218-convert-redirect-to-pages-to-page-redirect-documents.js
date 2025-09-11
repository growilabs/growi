import mongoose from 'mongoose';

// eslint-disable-next-line import/no-named-as-default
import PageRedirectModel from '~/server/models/page-redirect';
import { createBatchStream } from '~/server/util/batch-stream';
import {
  getModelSafely,
  getMongoUri,
  mongoOptions,
} from '~/server/util/mongoose-utils';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:migrate:convert-redirect-to-pages-to-page-redirect-documents',
);

const BATCH_SIZE = 100;

module.exports = {
  async up(db, client) {
    await mongoose.connect(getMongoUri(), mongoOptions);
    const pageCollection = await db.collection('pages');
    const PageRedirect = getModelSafely('PageRedirect') || PageRedirectModel;

    const cursor = pageCollection
      .find(
        { redirectTo: { $exists: true, $ne: null } },
        { path: 1, redirectTo: 1, _id: 0 },
      )
      .stream();
    const batchStream = createBatchStream(BATCH_SIZE);

    // redirectTo => PageRedirect
    for await (const pages of cursor.pipe(batchStream)) {
      const insertPageRedirectOperations = pages.map((page) => {
        return {
          insertOne: {
            document: {
              fromPath: page.path,
              toPath: page.redirectTo,
            },
          },
        };
      });

      try {
        await PageRedirect.bulkWrite(insertPageRedirectOperations);
      } catch (err) {
        if (err.code !== 11000) {
          throw Error(`Failed to migrate: ${err}`);
        }
      }
    }

    await pageCollection.deleteMany({ redirectTo: { $ne: null } });

    logger.info('Migration has successfully applied');
  },

  async down(db, client) {
    await mongoose.connect(getMongoUri(), mongoOptions);
    const pageCollection = await db.collection('pages');
    const PageRedirect = getModelSafely('PageRedirect') || PageRedirectModel;

    const cursor = PageRedirect.find().lean().cursor();
    const batchStream = createBatchStream(BATCH_SIZE);

    // PageRedirect => redirectTo
    for await (const pageRedirects of cursor.pipe(batchStream)) {
      const insertPageOperations = pageRedirects.map((pageRedirect) => {
        return {
          insertOne: {
            document: {
              path: pageRedirect.fromPath,
              redirectTo: pageRedirect.toPath,
            },
          },
        };
      });

      try {
        await pageCollection.bulkWrite(insertPageOperations);
      } catch (err) {
        if (err.code !== 11000) {
          throw Error(`Failed to migrate: ${err}`);
        }
      }
    }

    await PageRedirect.deleteMany();

    logger.info('Migration down has successfully applied');
  },
};
