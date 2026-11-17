import http from 'node:http';
import { getIdStringForRef } from '@growi/core';
import { YDocStatus } from '@growi/core/dist/consts';
import type { Server } from 'socket.io';
import { mock } from 'vitest-mock-extended';
import { docs, getYDoc } from 'y-websocket/bin/utils';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import { configManager } from '~/server/service/config-manager';
import { getYjsService, initializeYjsService } from '~/server/service/yjs';
import { prisma } from '~/utils/prisma';

import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import { createApplierTestKit } from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.184';
const PREFIX = '/cp-flow-collab-doc-integ';
const BACKGROUND = { kind: 'background' } as const;

// Opening the document in this process stands in for a browser opening the
// editor; the WebSocket transport itself is not part of this test.
describe('change proposal flow: the collaborative document after an apply', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  const openedPageIds: string[] = [];
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpFlowCollabDocRequester',
      subscriber: 'cpFlowCollabDocSubscriber',
      other: 'cpFlowCollabDocOther',
    },
  });
  const { users } = kit;

  const openDoc = (pageId: string): void => {
    openedPageIds.push(pageId);
    getYDoc(pageId);
  };

  const closeDoc = (pageId: string): void => {
    docs.get(pageId)?.destroy();
    docs.delete(pageId);
  };

  const editorTextOf = (pageId: string): string | undefined =>
    docs.get(pageId)?.getText('codemirror').toString();

  beforeAll(async () => {
    crowi = await getInstance();
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
    await kit.setUp();
    await configManager.updateConfigs({
      'changeProposal:autoApplyPolicy': 'none',
    });
    // No applier is injected: the editing-presence check runs on the real YjsService.
    service = createChangeProposalService(crowi);
  });

  beforeEach(() => {
    // Page events have async listeners (search, vault) unrelated to this test.
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
  });

  afterEach(async () => {
    await kit.waitForPageOperationsToFinish();
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
    const ids = (
      await prisma.changeproposals.findMany({
        where: { requester: users.requester._id.toString() },
        select: { id: true },
      })
    ).map((p) => p.id);
    await InAppNotification.deleteMany({ target: { $in: ids } });
    await prisma.activities.deleteMany({ where: { target: { in: ids } } });
    await prisma.changeproposals.deleteMany({ where: { id: { in: ids } } });
    await configManager.updateConfigs(
      { 'changeProposal:autoApplyPolicy': undefined },
      { removeIfUndefined: true },
    );
    await kit.tearDown();
  });

  it('shows the applied body the next time the page is opened in the editor', async () => {
    const page = await kit.createPage('共同編集/ページ');
    const pageId = page._id.toString();
    openDoc(pageId);
    await vi.waitFor(
      async () => {
        expect(editorTextOf(pageId)).toBe('base body');
        expect(await getYjsService().getYDocStatus(pageId)).toBe(
          YDocStatus.SYNCED,
        );
      },
      { timeout: 5000, interval: 50 },
    );
    closeDoc(pageId);
    if (page.revision == null) throw new Error('page has no revision');
    const created = await service.createProposal({
      requester: users.requester,
      entry: 'ai-chat',
      operations: [
        {
          type: 'edit',
          pageId,
          baseRevisionId: getIdStringForRef(page.revision),
          body: '# 反映した本文\n全角　スペースと絵文字🚀',
        },
      ],
    });
    if (!created.ok) throw new Error(JSON.stringify(created.error));

    const approved = await service.approve(
      created.value.proposalId,
      users.requester,
      'all',
      BACKGROUND,
    );

    expect(approved).toMatchObject({
      ok: true,
      value: { type: 'done', results: [{ status: 'applied' }] },
    });
    expect(await getYjsService().getYDocStatus(pageId)).toBe(
      YDocStatus.OUTDATED,
    );
    openDoc(pageId);
    await vi.waitFor(
      () => {
        expect(editorTextOf(pageId)).toBe(
          '# 反映した本文\n全角　スペースと絵文字🚀',
        );
      },
      { timeout: 5000, interval: 50 },
    );
  });
});
