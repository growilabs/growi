import mongoose from 'mongoose';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:service:yjs:create-indexes');

export const createIndexes = async (collectionName: string): Promise<void> => {
  const collection = mongoose.connection.collection(collectionName);

  try {
    await collection.createIndexes([
      {
        key: {
          version: 1,
          docName: 1,
          action: 1,
          clock: 1,
          part: 1,
        },
      },
      // for metaKey
      {
        key: {
          version: 1,
          docName: 1,
          metaKey: 1,
        },
      },
      // for flushDocument / clearDocument
      {
        key: {
          docName: 1,
          clock: 1,
        },
      },
    ]);
  } catch (err) {
    logger.error('Failed to create Index', err);
    throw err;
  }
};
