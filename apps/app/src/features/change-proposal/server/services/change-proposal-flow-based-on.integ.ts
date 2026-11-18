import { getIdStringForRef } from '@growi/core';
import type { HydratedDocument } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type {
  AutoApplyPolicy,
  BasedOn,
  ChangeProposalView,
  CreatableOperationInput,
} from '../../interfaces';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import { createApplierTestKit } from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.183';
const PREFIX = '/cp-flow-based-on-integ';
const BACKGROUND = { kind: 'background' } as const;

describe('change proposal flow: a follow-up and a rework built on an earlier proposal', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpFlowBasedOnRequester',
      subscriber: 'cpFlowBasedOnSubscriber',
      other: 'cpFlowBasedOnOther',
    },
  });
  const { users } = kit;

  const setPolicy = (policy: AutoApplyPolicy) =>
    configManager.updateConfigs({ 'changeProposal:autoApplyPolicy': policy });

  const editOf = async (
    pageId: string,
    body: string,
  ): Promise<CreatableOperationInput> => {
    const page: HydratedDocument<PageDocument> = await kit.findPage(pageId);
    if (page.revision == null) throw new Error(`${page.path} has no revision`);
    return {
      type: 'edit',
      pageId,
      baseRevisionId: getIdStringForRef(page.revision),
      body,
    };
  };

  const humanEdit = async (pageId: string, body: string): Promise<void> => {
    await crowi.pageService.updatePage(
      await kit.findPage(pageId),
      body,
      null,
      users.other,
      {},
    );
    await kit.waitForPageOperationsToFinish();
  };

  const create = async (
    operations: readonly CreatableOperationInput[],
    basedOn?: BasedOn,
  ) => {
    const result = await service.createProposal({
      requester: users.requester,
      entry: 'ai-chat',
      operations,
      basedOn,
    });
    await kit.waitForPageOperationsToFinish();
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.value;
  };

  const approveAll = async (proposalId: string) => {
    const result = await service.approve(
      proposalId,
      users.requester,
      'all',
      BACKGROUND,
    );
    await kit.waitForPageOperationsToFinish();
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.value;
  };

  const viewOf = async (proposalId: string): Promise<ChangeProposalView> => {
    const result = await service.getForViewer(proposalId, users.requester);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.value;
  };

  const latestBodyOf = async (pageId: string): Promise<string | undefined> => {
    const page = await kit.findPage(pageId);
    const revision = await prisma.revisions.findUnique({
      where: { id: page.revision?.toString() },
    });
    return revision?.body;
  };

  const snapshotOf = async (proposalId: string, key: string) => {
    const stored = await kit.reload(proposalId);
    const op = kit.operationOf(stored, key);
    return {
      lifecycle: stored.lifecycle,
      status: op.status,
      reason: op.reason,
      revertedByProposalId: op.revertedByProposalId,
    };
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    service = createChangeProposalService(crowi, {
      applier: kit.newApplier(),
    });
  });

  beforeEach(() => {
    // Page events have async listeners (search, vault) unrelated to this test.
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
  });

  afterEach(async () => {
    await kit.waitForPageOperationsToFinish();
    vi.restoreAllMocks();
    await configManager.updateConfigs(
      { 'changeProposal:autoApplyPolicy': undefined },
      { removeIfUndefined: true },
    );
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
    await kit.tearDown();
  });

  it('applies a follow-up of a stale operation while the original stays settled with that operation still stale, and links the two', async () => {
    await setPolicy('none');
    const applied = await kit.createPage('後続/反映される');
    const staled = await kit.createPage('後続/古くなる');
    const original = await create([
      await editOf(applied._id.toString(), '最初の提案'),
      await editOf(staled._id.toString(), '古くなる提案'),
    ]);
    await humanEdit(staled._id.toString(), '人の編集');
    await approveAll(original.proposalId);
    const staleKey = (await kit.reload(original.proposalId)).operations[1].key;
    const before = await snapshotOf(original.proposalId, staleKey);
    expect(before).toEqual({
      lifecycle: 'settled',
      status: 'stale',
      reason: 'base-revision-changed',
      revertedByProposalId: undefined,
    });
    const basedOn: BasedOn = {
      proposalId: original.proposalId,
      relation: 'follow-up',
      operationKeys: [staleKey],
    };

    const followUp = await create(
      [await editOf(staled._id.toString(), '人の編集を踏まえた提案')],
      basedOn,
    );
    expect(followUp.apply).toBeNull();
    expect(await snapshotOf(original.proposalId, staleKey)).toEqual(before);

    expect(await approveAll(followUp.proposalId)).toMatchObject({
      type: 'done',
      results: [{ status: 'applied' }],
    });

    expect(await snapshotOf(original.proposalId, staleKey)).toEqual(before);
    expect(await latestBodyOf(staled._id.toString())).toBe(
      '人の編集を踏まえた提案',
    );
    const originalView = await viewOf(original.proposalId);
    expect(
      originalView.operations.map((op) => [op.key, op.linkedProposals ?? []]),
    ).toEqual([
      [originalView.operations[0].key, []],
      [staleKey, [{ proposalId: followUp.proposalId, relation: 'follow-up' }]],
    ]);
    expect((await viewOf(followUp.proposalId)).basedOn).toEqual(basedOn);
  });

  it('keeps a rework of a revert-refused operation waiting, and applying it never marks the original operation reverted', async () => {
    await setPolicy('none');
    const page = await kit.createPage('見直し/ページ');
    const original = await create([
      await editOf(page._id.toString(), '最初の提案'),
    ]);
    await approveAll(original.proposalId);
    await humanEdit(page._id.toString(), '反映のあとの人の編集');
    const [key] = (await kit.reload(original.proposalId)).operations.map(
      (op) => op.key,
    );
    const refused = await service.revert(
      original.proposalId,
      users.requester,
      'all-visible',
      BACKGROUND,
    );
    expect(refused).toEqual({
      ok: true,
      value: {
        operations: [
          { key, outcome: 'revert-refused', reason: 'edited-after-apply' },
        ],
      },
    });
    const before = await snapshotOf(original.proposalId, key);
    expect(before).toEqual({
      lifecycle: 'settled',
      status: 'revert-refused',
      reason: 'edited-after-apply',
      revertedByProposalId: undefined,
    });
    const basedOn: BasedOn = {
      proposalId: original.proposalId,
      relation: 'rework',
      operationKeys: [key],
    };

    // Even the most permissive policy leaves a rework to the requester.
    await setPolicy('all');
    const rework = await create(
      [await editOf(page._id.toString(), '見直した本文')],
      basedOn,
    );

    expect(rework.apply).toBeNull();
    expect(
      (await kit.reload(rework.proposalId)).operations.map((op) => [
        op.status,
        op.approvedAt,
      ]),
    ).toEqual([['pending', undefined]]);
    expect(await snapshotOf(original.proposalId, key)).toEqual(before);

    expect(await approveAll(rework.proposalId)).toMatchObject({
      type: 'done',
      results: [{ status: 'applied' }],
    });

    expect(await snapshotOf(original.proposalId, key)).toEqual(before);
    const originalView = await viewOf(original.proposalId);
    expect(originalView.status).not.toBe('reverted');
    expect(originalView.operations[0].linkedProposals).toEqual([
      { proposalId: rework.proposalId, relation: 'rework' },
    ]);
    expect((await viewOf(rework.proposalId)).basedOn).toEqual(basedOn);
  });
});
