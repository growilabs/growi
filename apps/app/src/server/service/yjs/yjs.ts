import type http from 'node:http';
import { YDocStatus } from '@growi/core/dist/consts';
import mongoose from 'mongoose';
import type { Server } from 'socket.io';
import { WebSocketServer } from 'ws';
import type { WSSharedDoc } from 'y-websocket/bin/utils';
import { docs, setPersistence, setupWSConnection } from 'y-websocket/bin/utils';

import type { SyncLatestRevisionBody } from '~/interfaces/yjs';
import loggerFactory from '~/utils/logger';

import { Revision } from '../../models/revision';
import { normalizeLatestRevisionIfBroken } from '../revision/normalize-latest-revision-if-broken';
import { createIndexes } from './create-indexes';
import { createMongoDBPersistence } from './create-mongodb-persistence';
import { MongodbPersistence } from './extended/mongodb-persistence';
import { syncYDoc } from './sync-ydoc';
import { createUpgradeHandler } from './upgrade-handler';

const MONGODB_PERSISTENCE_COLLECTION_NAME = 'yjs-writings';
const MONGODB_PERSISTENCE_FLUSH_SIZE = 100;
const YJS_PATH_PREFIX = '/yjs/';

const logger = loggerFactory('growi:service:yjs');

export interface IYjsService {
  getYDocStatus(pageId: string): Promise<YDocStatus>;
  syncWithTheLatestRevisionForce(
    pageId: string,
    editingMarkdownLength?: number,
  ): Promise<SyncLatestRevisionBody>;
  getCurrentYdoc(pageId: string): WSSharedDoc | undefined;
}

type SessionConfig = {
  rolling: boolean;
  secret: string;
  resave: boolean;
  saveUninitialized: boolean;
  cookie: { maxAge: number };
  genid: (req: { path: string }) => string;
  name?: string;
  store?: unknown;
};

class YjsService implements IYjsService {
  private mdb: MongodbPersistence;

  constructor(
    httpServer: http.Server,
    io: Server,
    sessionConfig: SessionConfig,
  ) {
    const mdb = new MongodbPersistence(
      {
        // TODO: Required upgrading mongoose and unifying the versions of mongodb to omit 'as any'
        client: mongoose.connection.getClient() as any,
        db: mongoose.connection.db as any,
      },
      {
        collectionName: MONGODB_PERSISTENCE_COLLECTION_NAME,
        flushSize: MONGODB_PERSISTENCE_FLUSH_SIZE,
      },
    );
    this.mdb = mdb;

    // create indexes
    createIndexes(MONGODB_PERSISTENCE_COLLECTION_NAME);

    // setup y-websocket persistence (includes awareness bridge and sync-on-load)
    const persistence = createMongoDBPersistence(mdb, io, syncYDoc, (pageId) =>
      this.getYDocStatus(pageId),
    );
    setPersistence(persistence);

    // setup WebSocket server
    const wss = new WebSocketServer({ noServer: true });
    const handleUpgrade = createUpgradeHandler(sessionConfig);

    httpServer.on('upgrade', async (request, socket, head) => {
      const url = request.url ?? '';

      // Only handle /yjs/ paths; let Socket.IO and others pass through
      if (!url.startsWith(YJS_PATH_PREFIX)) {
        return;
      }

      const result = await handleUpgrade(request, socket, head);

      if (!result.authorized) {
        return;
      }

      wss.handleUpgrade(result.request, socket, head, (ws) => {
        wss.emit('connection', ws, result.request);
        setupWSConnection(ws, result.request, { docName: result.pageId });
      });
    });

    logger.info('YjsService initialized with y-websocket');
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
    const doc = docs.get(pageId);

    if (doc == null) {
      return { synced: false };
    }

    const ytextLength = doc.getText('codemirror').length;
    await syncYDoc(this.mdb, doc, true);

    return {
      synced: true,
      isYjsDataBroken:
        editingMarkdownLength != null
          ? editingMarkdownLength !== ytextLength
          : undefined,
    };
  }

  public getCurrentYdoc(pageId: string): WSSharedDoc | undefined {
    return docs.get(pageId);
  }
}

let _instance: YjsService;

export const initializeYjsService = (
  httpServer: http.Server,
  io: Server,
  sessionConfig: SessionConfig,
): void => {
  if (_instance != null) {
    throw new Error('YjsService is already initialized');
  }

  if (httpServer == null) {
    throw new Error("'httpServer' is required to initialize YjsService");
  }

  if (io == null) {
    throw new Error("'io' is required to initialize YjsService");
  }

  _instance = new YjsService(httpServer, io, sessionConfig);
};

export const getYjsService = (): YjsService => {
  if (_instance == null) {
    throw new Error('YjsService is not initialized yet');
  }

  return _instance;
};
