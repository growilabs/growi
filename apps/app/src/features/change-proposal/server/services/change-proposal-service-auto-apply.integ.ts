import type { IUserHasId } from '@growi/core';
import { getIdStringForRef } from '@growi/core';

import { getInstance } from '^/test/setup/crowi';

import { ActionGroupSize, SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { beginActivity } from '~/server/service/activity/index';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type {
  AutoApplyPolicy,
  CreatableOperationInput,
} from '../../interfaces';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import { createApplierTestKit } from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.152';
const TEST_ENDPOINT = '/_api/v3/cp-service-auto-apply-integ';
const PREFIX = '/cp-service-auto-apply-integ';

describe('ChangeProposalService.createProposal: auto-apply and activity', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpServiceAutoApplyRequester',
      subscriber: 'cpServiceAutoApplySubscriber',
      other: 'cpServiceAutoApplyOther',
    },
  });
  const { users } = kit;
  const request = { ip: TEST_IP, endpoint: TEST_ENDPOINT };

  const setPolicy = (policy: AutoApplyPolicy) =>
    configManager.updateConfigs({ 'changeProposal:autoApplyPolicy': policy });

  const createOwnPage = async (label: string) => {
    const page = await crowi.pageService.create(
      kit.nextPath(label),
      'own body',
      users.requester,
      {},
    );
    await kit.waitForPageOperationsToFinish();
    return kit.findPage(page._id);
  };

  const editOf = (
    page: Parameters<typeof kit.editInput>[0],
  ): CreatableOperationInput => {
    const op = kit.editInput(page);
    if (op.type !== 'edit') throw new Error('not an edit');
    return op;
  };

  const createdOk = async (
    result: Awaited<ReturnType<ChangeProposalService['createProposal']>>,
  ) => {
    if (!result.ok) {
      throw new Error(`not created: ${JSON.stringify(result.error)}`);
    }
    return {
      ...result.value,
      stored: await kit.reload(result.value.proposalId),
    };
  };

  const activitiesOf = (proposalId: string) =>
    prisma.activities.findMany({
      where: { target: proposalId },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    // CHANGE_PROPOSAL_CREATE follows the audit log settings (7.7).
    await configManager.updateConfigs({
      'app:auditLogEnabled': true,
      'app:auditLogActionGroupSize': ActionGroupSize.Medium,
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
    await kit.waitForPageOperationsToFinish();
    vi.restoreAllMocks();
    await configManager.updateConfigs(
      { 'changeProposal:autoApplyPolicy': undefined },
      { removeIfUndefined: true },
    );
  });

  afterAll(async () => {
    await prisma.changeproposals.deleteMany({
      where: { requester: users.requester._id.toString() },
    });
    await configManager.updateConfigs(
      {
        'app:auditLogEnabled': undefined,
        'app:auditLogActionGroupSize': undefined,
      },
      { removeIfUndefined: true },
    );
    await kit.tearDown();
  });

  describe('auto-apply policy', () => {
    it('leaves every operation waiting for approval under "none"', async () => {
      await setPolicy('none');
      const page = await createOwnPage('none-own');

      const { apply, stored } = await createdOk(
        await service.createProposal({
          requester: users.requester,
          entry: 'ai-chat',
          operations: [
            editOf(page),
            { type: 'create', path: kit.nextPath('none-new'), body: 'x' },
          ],
          request,
        }),
      );

      expect(apply).toBeNull();
      expect(stored.lifecycle).toBe('open');
      expect(stored.operations.map((op) => [op.status, op.approvedAt])).toEqual(
        [
          ['pending', undefined],
          ['pending', undefined],
        ],
      );
    });

    it('applies every operation right away under "all" and settles the proposal', async () => {
      await setPolicy('all');
      const othersPage = await kit.createPage('all-others');
      const createdPath = kit.nextPath('全部 新規');

      const { apply, stored } = await createdOk(
        await service.createProposal({
          requester: users.requester,
          entry: 'mcp',
          operations: [
            editOf(othersPage),
            { type: 'create', path: createdPath, body: '本文' },
          ],
          request,
        }),
      );

      expect(stored.operations.map((op) => op.status)).toEqual([
        'applied',
        'applied',
      ]);
      expect(apply).toEqual({
        type: 'done',
        results: expect.arrayContaining(
          stored.operations.map((op) => ({ key: op.key, status: 'applied' })),
        ),
      });
      expect(stored.lifecycle).toBe('settled');
      const edited = await kit.findPage(othersPage._id);
      expect(
        await prisma.revisions.findUnique({
          where: { id: getIdStringForRef(edited.revision ?? '') },
        }),
      ).toMatchObject({ authorId: users.requester._id.toString() });
    });

    it('applies only creations and pages the requester created under "own-pages"', async () => {
      await setPolicy('own-pages');
      const own = await createOwnPage('own-pages-own');
      const others = await kit.createPage('own-pages-others');

      const { apply, stored } = await createdOk(
        await service.createProposal({
          requester: users.requester,
          entry: 'ai-chat',
          operations: [
            editOf(own),
            editOf(others),
            { type: 'create', path: kit.nextPath('own-pages-new'), body: 'x' },
          ],
          request,
        }),
      );

      expect(stored.operations.map((op) => op.status)).toEqual([
        'applied',
        'pending',
        'applied',
      ]);
      expect(stored.operations[1].approvedAt).toBeUndefined();
      expect(apply?.type).toBe('done');
      expect(stored.lifecycle).toBe('open');
    });
  });

  describe('activity', () => {
    it('records the creation in the background with the requester as operator, separately from the apply', async () => {
      await setPolicy('all');

      const { proposalId } = await createdOk(
        await service.createProposal({
          requester: users.requester,
          entry: 'ai-chat',
          operations: [
            { type: 'create', path: kit.nextPath('bg-new'), body: 'x' },
          ],
          request,
        }),
      );

      const rows = await vi.waitFor(
        async () => {
          const found = await activitiesOf(proposalId);
          expect(found).toHaveLength(2);
          return found;
        },
        { timeout: 5000, interval: 50 },
      );
      expect(rows.map((r) => r.action).sort()).toEqual(
        [
          SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
          SupportedAction.ACTION_CHANGE_PROPOSAL_CREATE,
        ].sort(),
      );
      for (const row of rows) {
        expect(row).toMatchObject({
          userId: users.requester._id.toString(),
          ip: TEST_IP,
          endpoint: TEST_ENDPOINT,
        });
      }
    });

    it("settles the caller's request activity as the creation, keeping its operator, and records the apply as a separate row", async () => {
      await setPolicy('all');
      const { activityId } = beginActivity({
        ip: TEST_IP,
        endpoint: TEST_ENDPOINT,
        userId: users.requester._id.toString(),
        username: users.requester.username,
        createdAt: new Date(),
      });

      const { proposalId } = await createdOk(
        await service.createProposal({
          requester: users.requester,
          entry: 'ai-chat',
          operations: [
            { type: 'create', path: kit.nextPath('req-new'), body: 'x' },
          ],
          request,
          trigger: { kind: 'request', activityId },
        }),
      );

      const rows = await vi.waitFor(
        async () => {
          const found = await activitiesOf(proposalId);
          expect(found).toHaveLength(2);
          return found;
        },
        { timeout: 5000, interval: 50 },
      );
      const createRow = rows.find(
        (r) => r.action === SupportedAction.ACTION_CHANGE_PROPOSAL_CREATE,
      );
      const applyRow = rows.find(
        (r) => r.action === SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
      );
      expect(createRow?.id).toBe(activityId);
      expect(createRow).toMatchObject({
        userId: users.requester._id.toString(),
      });
      expect(applyRow?.id).not.toBe(activityId);
      expect(applyRow).toMatchObject({ ip: TEST_IP, endpoint: TEST_ENDPOINT });
    });

    it('records only the creation when nothing is auto-applied', async () => {
      await setPolicy('none');
      const requester: IUserHasId = users.requester;

      const { proposalId } = await createdOk(
        await service.createProposal({
          requester,
          entry: 'vault',
          operations: [
            { type: 'create', path: kit.nextPath('none-act'), body: 'x' },
          ],
          request,
        }),
      );

      const rows = await vi.waitFor(
        async () => {
          const found = await activitiesOf(proposalId);
          expect(found).toHaveLength(1);
          return found;
        },
        { timeout: 5000, interval: 50 },
      );
      expect(rows[0].action).toBe(
        SupportedAction.ACTION_CHANGE_PROPOSAL_CREATE,
      );
    });
  });
});
