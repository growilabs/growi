import http from 'node:http';
import type { IUserHasId } from '@growi/core';
import { getIdStringForRef } from '@growi/core';
import { YDocStatus } from '@growi/core/dist/consts';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';
import type { Server } from 'socket.io';
import { mock } from 'vitest-mock-extended';
import { docs, getYDoc } from 'y-websocket/bin/utils';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import type {
  IPageOperation,
  PageOperationModel,
} from '~/server/models/page-operation';
import { UserStatus } from '~/server/models/user/conts';
import { configManager } from '~/server/service/config-manager';
import { getYjsService, initializeYjsService } from '~/server/service/yjs';
import { prisma } from '~/utils/prisma';

import { createEditHandler } from './edit';

const PREFIX = '/cp-edit-collab-doc-integ';
const USERNAME = 'cpEditCollabDocRequester';

describe('edit operation handler and the collaborative document', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let PageOperation: PageOperationModel;
  let requester: HydratedDocument<IUserHasId>;
  const openedPageIds: string[] = [];

  const waitForPageOperationsToFinish = async (): Promise<void> => {
    await vi.waitFor(
      async () => {
        const remaining = await PageOperation.countDocuments({
          fromPath: new RegExp(`^${PREFIX}/`),
        });
        expect(remaining).toBe(0);
      },
      { timeout: 5000, interval: 50 },
    );
  };

  const openDoc = (pageId: string): void => {
    openedPageIds.push(pageId);
    getYDoc(pageId);
  };

  const closeDoc = (pageId: string): void => {
    docs.get(pageId)?.destroy();
    docs.delete(pageId);
  };

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    PageOperation = mongoose.model<IPageOperation, PageOperationModel>(
      'PageOperation',
    );
    // The awareness bridge broadcasts through io.in(room) when a doc is destroyed.
    // A plain function, so vi.restoreAllMocks() in afterEach cannot reset it.
    const room = mock<ReturnType<Server['in']>>();
    const io = mock<Server>({ in: () => room });
    initializeYjsService(http.createServer(), io, {
      rolling: true,
      secret: 'test-secret',
      resave: false,
      saveUninitialized: true,
      cookie: { maxAge: 86400000 },
      genid: () => 'test-session-id',
    });
    await configManager.updateConfigs({ 'app:isV5Compatible': true });
    const existingRoot = await Page.findOne({ path: '/' });
    if (existingRoot == null) {
      await Page.create({ path: '/', grant: Page.GRANT_PUBLIC });
    }
    requester = await mongoose.model<IUserHasId>('User').create({
      name: USERNAME,
      username: USERNAME,
      email: `${USERNAME}@example.com`,
      status: UserStatus.STATUS_ACTIVE,
    });
  });

  beforeEach(() => {
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    // biome-ignore lint/complexity/useLiteralKeys: mdb is private; persisted Y.Docs of this file are removed
    const mdb = getYjsService()['mdb'];
    await Promise.all(
      openedPageIds.map(async (pageId) => {
        closeDoc(pageId);
        await mdb.clearDocument(pageId);
      }),
    );
    const pages = await Page.find({ path: new RegExp(`^${PREFIX}/`) });
    await prisma.revisions.deleteMany({
      where: { pageId: { in: pages.map((p) => p._id.toString()) } },
    });
    await Page.deleteMany({ _id: { $in: pages.map((p) => p._id) } });
    await mongoose.model('User').deleteMany({ username: USERNAME });
    await configManager.updateConfigs(
      { 'app:isV5Compatible': undefined },
      { removeIfUndefined: true },
    );
  });

  it('shows the applied body when the document, already opened before the apply, is opened again', async () => {
    const created = await crowi.pageService.create(
      `${PREFIX}/page`,
      'base body',
      requester,
      {},
    );
    await waitForPageOperationsToFinish();
    const page = await Page.findById(created._id);
    if (page?.revision == null) {
      throw new Error('page or its revision is missing');
    }
    const pageId = page._id.toString();

    openDoc(pageId);
    await vi.waitFor(
      async () => {
        expect(docs.get(pageId)?.getText('codemirror').toString()).toBe(
          'base body',
        );
        expect(await getYjsService().getYDocStatus(pageId)).not.toBe(
          YDocStatus.NEW,
        );
      },
      { timeout: 5000, interval: 50 },
    );
    closeDoc(pageId);

    const handler = createEditHandler(crowi);
    const outcome = await handler.execute(
      {
        type: 'edit',
        index: 0,
        key: 'op-edit',
        status: 'pending',
        pageId,
        baseRevisionId: getIdStringForRef(page.revision),
        body: 'proposed body',
      },
      {
        proposalId: new mongoose.Types.ObjectId().toString(),
        operationKey: 'op-edit',
        requester,
        activityParameters: {},
        perPageNotifications: false,
      },
    );
    expect(outcome.status).toBe('applied');
    expect(await getYjsService().getYDocStatus(pageId)).toBe(
      YDocStatus.OUTDATED,
    );

    openDoc(pageId);
    await vi.waitFor(
      () => {
        expect(docs.get(pageId)?.getText('codemirror').toString()).toBe(
          'proposed body',
        );
      },
      { timeout: 5000, interval: 50 },
    );
  });
});
