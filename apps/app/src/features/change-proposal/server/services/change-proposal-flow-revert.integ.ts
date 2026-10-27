import { getIdStringForRef } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument, PageModel } from '~/server/models/page';
import type {
  IPageOperation,
  PageOperationModel,
} from '~/server/models/page-operation';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type {
  ChangeProposalDocument,
  ChangeProposalView,
  CreatableOperationInput,
} from '../../interfaces';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import type { ServiceResult } from './change-proposal-service-types';
import { createApplierTestKit } from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.182';
const PREFIX = '/cp-flow-revert-integ';
const BACKGROUND = { kind: 'background' } as const;

describe('change proposal flow: apply, revert everything, then revert the revert', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpFlowRevertRequester',
      subscriber: 'cpFlowRevertSubscriber',
      other: 'cpFlowRevertOther',
    },
  });
  const { users } = kit;
  const Page = () => mongoose.model<PageDocument, PageModel>('Page');
  const PageOperation = () =>
    mongoose.model<IPageOperation, PageOperationModel>('PageOperation');

  // The kit only waits for operations under PREFIX; a restore starts from the trash.
  const waitForPageOperations = async (): Promise<void> => {
    await vi.waitFor(
      async () => {
        expect(
          await PageOperation().countDocuments({
            fromPath: new RegExp(`^(/trash)?${PREFIX}/`),
          }),
        ).toBe(0);
      },
      { timeout: 5000, interval: 50 },
    );
  };

  const editOf = (
    page: HydratedDocument<PageDocument>,
    body: string,
  ): CreatableOperationInput => {
    if (page.revision == null) throw new Error(`${page.path} has no revision`);
    return {
      type: 'edit',
      pageId: page._id.toString(),
      baseRevisionId: getIdStringForRef(page.revision),
      body,
    };
  };

  const latestBodyOf = async (pageId: string): Promise<string | undefined> => {
    const page = await kit.findPage(pageId);
    const revision = await prisma.revisions.findUnique({
      where: { id: page.revision?.toString() },
    });
    return revision?.body;
  };

  const viewOf = async (proposalId: string): Promise<ChangeProposalView> => {
    const result: ServiceResult<ChangeProposalView> =
      await service.getForViewer(proposalId, users.requester);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.value;
  };

  const revertAll = async (proposalId: string) => {
    const result = await service.revert(
      proposalId,
      users.requester,
      'all-visible',
      BACKGROUND,
    );
    await waitForPageOperations();
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const { revertProposalId } = result.value;
    if (revertProposalId == null) throw new Error('nothing was reverted');
    return { result: result.value, revert: await kit.reload(revertProposalId) };
  };

  const statesOf = (proposal: ChangeProposalDocument) =>
    proposal.operations.map((op) => [
      op.type,
      op.status,
      op.revertedByProposalId,
    ]);

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    await configManager.updateConfigs({
      'changeProposal:autoApplyPolicy': 'none',
    });
    service = createChangeProposalService(crowi, {
      applier: kit.newApplier(),
    });
  });

  beforeEach(() => {
    // Page events have async listeners (search, vault) unrelated to this test.
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
  });

  afterEach(async () => {
    await waitForPageOperations();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    const ids = (
      await prisma.changeproposals.findMany({
        where: { requester: users.requester._id.toString() },
        select: { id: true },
      })
    ).map((p) => p.id);
    await InAppNotification.deleteMany({ target: { $in: ids } });
    await prisma.activities.deleteMany({ where: { target: { in: ids } } });
    await prisma.changeproposals.deleteMany({ where: { id: { in: ids } } });
    const trashed = await Page().find({
      path: new RegExp(`^/trash${PREFIX}/`),
    });
    await prisma.revisions.deleteMany({
      where: { pageId: { in: trashed.map((p) => p._id.toString()) } },
    });
    await Page().deleteMany({ _id: { $in: trashed.map((p) => p._id) } });
    await prisma.pageredirects.deleteMany({
      where: { fromPath: { startsWith: PREFIX } },
    });
    await configManager.updateConfigs(
      { 'changeProposal:autoApplyPolicy': undefined },
      { removeIfUndefined: true },
    );
    await kit.tearDown();
  });

  it('records each revert on the operations it reverted and moves the created page to the trash and back', async () => {
    const edited = await kit.createPage('取り消し/編集　ページ');
    const moved = await kit.createPage('取り消し/移動元');
    await kit.subscribe(edited);
    const originalMovedPath = moved.path;
    const movedTo = kit.nextPath('取り消し/移動先（後）');
    const createdPath = kit.nextPath('取り消し/新規　ページ');
    const created = await service.createProposal({
      requester: users.requester,
      entry: 'ai-chat',
      operations: [
        editOf(edited, '提案した本文'),
        { type: 'create', path: createdPath, body: '作った本文' },
        {
          type: 'move',
          pageId: moved._id.toString(),
          fromPath: originalMovedPath,
          toPath: movedTo,
        },
      ],
    });
    if (!created.ok) throw new Error(JSON.stringify(created.error));
    const proposalId = created.value.proposalId;
    await service.approve(proposalId, users.requester, 'all', BACKGROUND);
    await waitForPageOperations();
    const original = await kit.reload(proposalId);
    expect(original.lifecycle).toBe('settled');
    const createdPageId = original.operations[1].resultPageId;
    if (createdPageId == null) throw new Error('create was not applied');
    const createdRevisionId = original.operations[1].resultRevisionId;

    // 1st revert: everything the requester sees
    const first = await revertAll(proposalId);

    expect(first.result.operations).toEqual(
      original.operations.map((op) => ({ key: op.key, outcome: 'reverted' })),
    );
    expect(first.revert).toMatchObject({
      entry: 'revert',
      revertOf: proposalId,
      lifecycle: 'settled',
    });
    expect(statesOf(first.revert)).toEqual([
      ['edit', 'applied', undefined],
      ['trash', 'applied', undefined],
      ['move', 'applied', undefined],
    ]);
    expect(statesOf(await kit.reload(proposalId))).toEqual([
      ['edit', 'reverted', first.revert._id],
      ['create', 'reverted', first.revert._id],
      ['move', 'reverted', first.revert._id],
    ]);
    expect(await latestBodyOf(edited._id.toString())).toBe('base body');
    const trashedPage = await kit.findPage(createdPageId);
    expect(trashedPage.path).toBe(`/trash${createdPath}`);
    expect((await kit.findPage(moved._id)).path).toBe(originalMovedPath);
    // the subscriber hears about the revert once, as a revert
    expect(
      (await kit.aggregatedNotifications(first.revert._id)).map((n) => [
        String(n.user),
        n.action,
      ]),
    ).toEqual([
      [
        users.subscriber._id.toString(),
        SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT,
      ],
    ]);

    // 2nd revert: the revert proposal itself
    const second = await revertAll(first.revert._id);

    expect(second.result.operations).toEqual(
      first.revert.operations.map((op) => ({
        key: op.key,
        outcome: 'reverted',
      })),
    );
    expect(second.revert).toMatchObject({
      entry: 'revert',
      revertOf: first.revert._id,
      lifecycle: 'settled',
    });
    expect(statesOf(second.revert)).toEqual([
      ['edit', 'applied', undefined],
      ['restore', 'applied', undefined],
      ['move', 'applied', undefined],
    ]);
    expect(statesOf(await kit.reload(first.revert._id))).toEqual([
      ['edit', 'reverted', second.revert._id],
      ['trash', 'reverted', second.revert._id],
      ['move', 'reverted', second.revert._id],
    ]);
    // the original keeps the record of the revert that reverted it
    expect(statesOf(await kit.reload(proposalId))).toEqual([
      ['edit', 'reverted', first.revert._id],
      ['create', 'reverted', first.revert._id],
      ['move', 'reverted', first.revert._id],
    ]);
    expect(await latestBodyOf(edited._id.toString())).toBe('提案した本文');
    const restored = await kit.findPage(createdPageId);
    expect(restored.path).toBe(createdPath);
    expect(getIdStringForRef(restored.revision ?? '')).toBe(createdRevisionId);
    expect((await kit.findPage(moved._id)).path).toBe(movedTo);

    expect((await viewOf(proposalId)).status).toBe('reverted');
    expect((await viewOf(first.revert._id)).status).toBe('reverted');
    expect((await viewOf(second.revert._id)).status).toBe('applied');
  });
});
