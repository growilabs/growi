import type { Persistence } from 'y-socket.io/dist/server';
import * as Y from 'yjs';

import loggerFactory from '~/utils/logger';

import type { MongodbPersistence } from './extended/mongodb-persistence';

const logger = loggerFactory('growi:service:yjs:create-mongodb-persistence');

/**
 * Based on the example by https://github.com/MaxNoetzold/y-mongodb-provider?tab=readme-ov-file#an-other-example
 * @param mdb
 * @returns
 */
export const createMongoDBPersistence = (
  mdb: MongodbPersistence,
): Persistence => {
  const persistece: Persistence = {
    provider: mdb,
    bindState: async (docName, ydoc) => {
      logger.debug('bindState', { docName });

      const persistedYdoc = await mdb.getYDoc(docName);

      // get the state vector so we can just store the diffs between client and server
      const persistedStateVector = Y.encodeStateVector(persistedYdoc);
      const diff = Y.encodeStateAsUpdate(ydoc, persistedStateVector);

      // store the new data in db (if there is any: empty update is an array of 0s)
      if (
        diff.reduce(
          (previousValue, currentValue) => previousValue + currentValue,
          0,
        ) > 0
      ) {
        mdb.storeUpdate(docName, diff);
        mdb.setTypedMeta(docName, 'updatedAt', Date.now());
      }

      // send the persisted data to clients
      Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedYdoc));

      // store updates of the document in db
      ydoc.on('update', async (update) => {
        mdb.storeUpdate(docName, update);
        mdb.setTypedMeta(docName, 'updatedAt', Date.now());
      });

      // cleanup some memory
      persistedYdoc.destroy();
    },
    writeState: async (docName) => {
      logger.debug('writeState', { docName });
      // This is called when all connections to the document are closed.

      // flush document on close to have the smallest possible database
      await mdb.flushDocument(docName);
    },
  };

  return persistece;
};
