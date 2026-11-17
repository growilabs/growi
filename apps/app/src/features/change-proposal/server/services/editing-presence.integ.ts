import http from 'node:http';
import { Types } from 'mongoose';
import type { Server } from 'socket.io';
import { mock } from 'vitest-mock-extended';
import type { WebSocket } from 'ws';
import type { WSSharedDoc } from 'y-websocket/bin/utils';
import { docs } from 'y-websocket/bin/utils';

import { getYjsService, initializeYjsService } from '~/server/service/yjs';
import { prisma } from '~/utils/prisma';

import { checkEditingPresence } from './editing-presence';

vi.mock('y-websocket/bin/utils', () => {
  const docs = new Map();
  return {
    docs,
    setPersistence: vi.fn(),
    setupWSConnection: vi.fn(),
    getYDoc: vi.fn(),
    setContentInitializor: vi.fn(),
  };
});

vi.mock(
  '~/server/service/revision/normalize-latest-revision-if-broken',
  () => ({
    normalizeLatestRevisionIfBroken: vi.fn(),
  }),
);

const getPrivateMdb = () => {
  // biome-ignore lint/complexity/useLiteralKeys: mdb is private; the test must seed the persisted Y.Doc timestamp
  return getYjsService()['mdb'];
};

describe('checkEditingPresence (with the real YjsService)', () => {
  beforeAll(() => {
    initializeYjsService(http.createServer(), mock<Server>(), {
      rolling: true,
      secret: 'test-secret',
      resave: false,
      saveUninitialized: true,
      cookie: { maxAge: 86400000 },
      genid: () => 'test-session-id',
    });
  });

  afterAll(async () => {
    try {
      await getPrivateMdb().flushDB();
    } catch (error) {
      // 26: NamespaceNotFound, 276: IndexBuildAborted (async index creation)
      const code = (error as { code?: number }).code;
      if (code !== 26 && code !== 276) {
        throw error;
      }
    }
  });

  afterEach(async () => {
    await prisma.revisions.deleteMany();
    docs.clear();
  });

  const createRevision = async (pageId: string): Promise<Date> => {
    const revision = await prisma.revisions.create({
      data: { pageId, body: '' },
    });
    return revision.createdAt;
  };

  it('is being edited (connected-in-this-process) while a connection exists', async () => {
    const pageId = new Types.ObjectId().toString();
    await createRevision(pageId);
    docs.set(
      pageId,
      mock<WSSharedDoc>({
        conns: new Map([[mock<WebSocket>(), new Set<number>()]]),
      }),
    );

    await expect(
      checkEditingPresence(getYjsService(), pageId),
    ).resolves.toEqual({
      isBeingEdited: true,
      cause: 'connected-in-this-process',
    });
  });

  it('is being edited (unsaved-draft) when nobody is connected but the Y.Doc is newer than the latest revision', async () => {
    const pageId = new Types.ObjectId().toString();
    await createRevision(pageId);
    await getPrivateMdb().setTypedMeta(
      pageId,
      'updatedAt',
      new Date(2034, 1, 1).getTime(),
    );

    await expect(
      checkEditingPresence(getYjsService(), pageId),
    ).resolves.toEqual({ isBeingEdited: true, cause: 'unsaved-draft' });
  });

  it('is not being edited when nobody is connected and the Y.Doc is in sync with the latest revision', async () => {
    const pageId = new Types.ObjectId().toString();
    const createdAt = await createRevision(pageId);
    await getPrivateMdb().setTypedMeta(
      pageId,
      'updatedAt',
      createdAt.getTime(),
    );

    await expect(
      checkEditingPresence(getYjsService(), pageId),
    ).resolves.toEqual({ isBeingEdited: false });
  });
});
