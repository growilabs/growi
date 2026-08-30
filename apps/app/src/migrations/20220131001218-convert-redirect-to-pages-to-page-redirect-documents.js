import { createBatchStream } from '~/server/util/batch-stream';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory(
  'growi:migrate:convert-redirect-to-pages-to-page-redirect-documents',
);

const BATCH_SIZE = 100;

export async function up(db) {
  const pageCollection = db.collection('pages');
  const pageRedirectCollection = db.collection('pageredirects');

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
      await pageRedirectCollection.bulkWrite(insertPageRedirectOperations);
    } catch (err) {
      if (err.code !== 11000) {
        throw Error(`Failed to migrate: ${err}`);
      }
    }
  }

  await pageCollection.deleteMany({ redirectTo: { $ne: null } });

  logger.info('Migration has successfully applied');
}

export async function down(db) {
  const pageCollection = db.collection('pages');
  const pageRedirectCollection = db.collection('pageredirects');

  const cursor = pageRedirectCollection.find().stream();
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

  await pageRedirectCollection.deleteMany({});

  logger.info('Migration down has successfully applied');
}
