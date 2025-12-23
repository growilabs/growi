import type { IPage, IUserHasId } from '@growi/core';
import { YDocStatus } from '@growi/core/dist/consts';
import type { IncomingMessage } from 'http';
import mongoose from 'mongoose';
import type { Server } from 'socket.io';
import type { Document } from 'y-socket.io/dist/server';
import { type Document as Ydoc, YSocketIO } from 'y-socket.io/dist/server';

import { SocketEventName } from '~/interfaces/websocket';
import type { SyncLatestRevisionBody } from '~/interfaces/yjs';
import {
  getRoomNameWithId,
  RoomPrefix,
} from '~/server/service/socket-io/helper';
import loggerFactory from '~/utils/logger';

import type { PageModel } from '../../models/page';
import { Revision } from '../../models/revision';
import { normalizeLatestRevisionIfBroken } from '../revision/normalize-latest-revision-if-broken';
import { createIndexes } from './create-indexes';
import { createMongoDBPersistence } from './create-mongodb-persistence';
import { MongodbPersistence } from './extended/mongodb-persistence';
import { syncYDoc } from './sync-ydoc';

const MONGODB_PERSISTENCE_COLLECTION_NAME = 'yjs-writings';
const MONGODB_PERSISTENCE_FLUSH_SIZE = 100;

const logger = loggerFactory('growi:service:yjs');

type RequestWithUser = IncomingMessage & { user: IUserHasId };

export interface IYjsService {
  getYDocStatus(pageId: string): Promise<YDocStatus>;
  syncWithTheLatestRevisionForce(
    pageId: string,
    editingMarkdownLength?: number,
  ): Promise<SyncLatestRevisionBody>;
  getCurrentYdoc(pageId: string): Ydoc | undefined;
}

class YjsService implements IYjsService {
  private ysocketio: YSocketIO;

  private mdb: MongodbPersistence;

  constructor(io: Server) {
    const mdb = new MongodbPersistence(
      {
        // TODO: Required upgrading mongoose and unifying the versions of mongodb to omit 'as any'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client: mongoose.connection.getClient() as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        db: mongoose.connection.db as any,
      },
      {
        collectionName: MONGODB_PERSISTENCE_COLLECTION_NAME,
        flushSize: MONGODB_PERSISTENCE_FLUSH_SIZE,
      },
    );
    this.mdb = mdb;

    // initialize YSocketIO
    const ysocketio = new YSocketIO(io);
    this.injectPersistence(ysocketio, mdb);
    ysocketio.initialize();
    this.ysocketio = ysocketio;

    // create indexes
    createIndexes(MONGODB_PERSISTENCE_COLLECTION_NAME);

    // register middlewares
    this.registerAccessiblePageChecker(ysocketio);

    ysocketio.on('document-loaded', async (doc: Document) => {
      const pageId = doc.name;

      const ydocStatus = await this.getYDocStatus(pageId);

      syncYDoc(mdb, doc, { ydocStatus });
    });

    ysocketio.on('awareness-update', async (doc: Document) => {
      const pageId = doc.name;

      if (pageId == null) return;

      const awarenessStateSize = doc.awareness.states.size;

      // Triggered when awareness changes
      io.in(getRoomNameWithId(RoomPrefix.PAGE, pageId)).emit(
        SocketEventName.YjsAwarenessStateSizeUpdated,
        awarenessStateSize,
      );

      // Triggered when the last user leaves the editor
      if (awarenessStateSize === 0) {
        const ydocStatus = await this.getYDocStatus(pageId);
        const hasYdocsNewerThanLatestRevision =
          ydocStatus === YDocStatus.DRAFT || ydocStatus === YDocStatus.ISOLATED;

        io.in(getRoomNameWithId(RoomPrefix.PAGE, pageId)).emit(
          SocketEventName.YjsHasYdocsNewerThanLatestRevisionUpdated,
          hasYdocsNewerThanLatestRevision,
        );
      }
    });
  }

  private injectPersistence(
    ysocketio: YSocketIO,
    mdb: MongodbPersistence,
  ): void {
    const persistece = createMongoDBPersistence(mdb);

    // foce set to private property
    // eslint-disable-next-line dot-notation
    ysocketio['persistence'] = persistece;
  }

  private registerAccessiblePageChecker(ysocketio: YSocketIO): void {
    // check accessible page
    ysocketio.nsp?.use(async (socket, next) => {
      // extract page id from namespace
      const pageId = socket.nsp.name.replace(/\/yjs\|/, '');
      const user = (socket.request as RequestWithUser).user; // should be injected by SocketIOService

      const Page = mongoose.model<IPage, PageModel>('Page');
      const isAccessible = await Page.isAccessiblePageByViewer(pageId, user);

      if (!isAccessible) {
        return next(new Error('Forbidden'));
      }

      return next();
    });
  }

  public async getYDocStatus(pageId: string): Promise<YDocStatus> {
    const dumpLog = (status: YDocStatus, args?: { [key: string]: unknown }) => {
      logger.debug(
        `getYDocStatus('${pageId}') detected '${status}'`,
        args ?? {},
      );
    };

    // Normalize the latest revision which was borken by the migration script '20211227060705-revision-path-to-page-id-schema-migration--fixed-7549.js' provided by v6.1.0 - v7.0.15
    await normalizeLatestRevisionIfBroken(pageId);

    // get the latest revision createdAt
    const result = await Revision.findOne(
      // filter
      { pageId },
      // projection
      { createdAt: 1 },
      { sort: { createdAt: -1 } },
    ).lean();

    if (result == null) {
      dumpLog(YDocStatus.ISOLATED, { result });
      return YDocStatus.ISOLATED;
    }

    // count yjs-writings documents with updatedAt > latestRevision.updatedAt
    const ydocUpdatedAt = await this.mdb.getTypedMeta(pageId, 'updatedAt');

    if (ydocUpdatedAt == null) {
      dumpLog(YDocStatus.NEW);
      return YDocStatus.NEW;
    }

    const { createdAt } = result;
    const lastRevisionCreatedAt = createdAt.getTime();

    if (lastRevisionCreatedAt < ydocUpdatedAt) {
      dumpLog(YDocStatus.DRAFT, { lastRevisionCreatedAt, ydocUpdatedAt });
      return YDocStatus.DRAFT;
    }

    if (lastRevisionCreatedAt === ydocUpdatedAt) {
      dumpLog(YDocStatus.SYNCED, { lastRevisionCreatedAt, ydocUpdatedAt });
      return YDocStatus.SYNCED;
    }

    dumpLog(YDocStatus.OUTDATED, { lastRevisionCreatedAt, ydocUpdatedAt });
    return YDocStatus.OUTDATED;
  }

  public async syncWithTheLatestRevisionForce(
    pageId: string,
    editingMarkdownLength?: number,
  ): Promise<SyncLatestRevisionBody> {
    const doc = this.ysocketio.documents.get(pageId);

    if (doc == null) {
      return { synced: false };
    }

    const ytextLength = doc?.getText('codemirror').length;
    syncYDoc(this.mdb, doc, true);

    return {
      synced: true,
      isYjsDataBroken:
        editingMarkdownLength != null
          ? editingMarkdownLength !== ytextLength
          : undefined,
    };
  }

  public getCurrentYdoc(pageId: string): Ydoc | undefined {
    const currentYdoc = this.ysocketio.documents.get(pageId);
    return currentYdoc;
  }
}

let _instance: YjsService;

export const initializeYjsService = (io: Server): void => {
  if (_instance != null) {
    throw new Error('YjsService is already initialized');
  }

  if (io == null) {
    throw new Error("'io' is required if initialize YjsService");
  }

  _instance = new YjsService(io);
};

export const getYjsService = (): YjsService => {
  if (_instance == null) {
    throw new Error('YjsService is not initialized yet');
  }

  return _instance;
};
