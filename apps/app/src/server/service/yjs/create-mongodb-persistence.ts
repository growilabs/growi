import { YDocStatus } from '@growi/core/dist/consts';
import type { Server } from 'socket.io';
import type { WSSharedDoc, YWebsocketPersistence } from 'y-websocket/bin/utils';
import * as Y from 'yjs';

import { SocketEventName } from '~/interfaces/websocket';
import {
  getRoomNameWithId,
  RoomPrefix,
} from '~/server/service/socket-io/helper';
import loggerFactory from '~/utils/logger';

import type { MongodbPersistence } from './extended/mongodb-persistence';
import type { syncYDoc as syncYDocType } from './sync-ydoc';

const logger = loggerFactory('growi:service:yjs:create-mongodb-persistence');

type GetYDocStatus = (pageId: string) => Promise<YDocStatus>;

/**
 * Creates a y-websocket compatible persistence layer backed by MongoDB.
 *
 * bindState also handles:
 * - sync-on-load (syncYDoc) after persisted state is applied
 * - awareness event bridge to Socket.IO rooms
 */
export const createMongoDBPersistence = (
  mdb: MongodbPersistence,
  io: Server,
  syncYDoc: typeof syncYDocType,
  getYDocStatus: GetYDocStatus,
): YWebsocketPersistence => {
  const persistence: YWebsocketPersistence = {
    provider: mdb,
    bindState: async (docName: string, ydoc: WSSharedDoc) => {
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

      // cleanup some memory
      persistedYdoc.destroy();

      // sync with the latest revision after persisted state is applied
      const ydocStatus = await getYDocStatus(docName);
      syncYDoc(mdb, ydoc, { ydocStatus });

      // store updates of the document in db
      ydoc.on('update', (update: Uint8Array) => {
        mdb.storeUpdate(docName, update);
        mdb.setTypedMeta(docName, 'updatedAt', Date.now());
      });

      // register awareness event bridge to Socket.IO rooms
      ydoc.awareness.on('update', async () => {
        const pageId = docName;
        const awarenessStateSize = ydoc.awareness.getStates().size;

        io.in(getRoomNameWithId(RoomPrefix.PAGE, pageId)).emit(
          SocketEventName.YjsAwarenessStateSizeUpdated,
          awarenessStateSize,
        );

        // emit draft status when last user leaves
        if (awarenessStateSize === 0) {
          const status = await getYDocStatus(pageId);
          const hasYdocsNewerThanLatestRevision =
            status === YDocStatus.DRAFT || status === YDocStatus.ISOLATED;

          io.in(getRoomNameWithId(RoomPrefix.PAGE, pageId)).emit(
            SocketEventName.YjsHasYdocsNewerThanLatestRevisionUpdated,
            hasYdocsNewerThanLatestRevision,
          );
        }
      });
    },
    writeState: async (docName: string) => {
      logger.debug('writeState', { docName });
      // flush document on close to have the smallest possible database
      await mdb.flushDocument(docName);
    },
  };

  return persistence;
};
