import type { IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { UserStatus } from '~/server/models/user/conts';
import {
  beginActivity,
  pendingActivityContext,
} from '~/server/service/activity/index';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type { ChangeProposalDocument } from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import { createApplierTestKit } from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.154';
const TEST_ENDPOINT = '/_api/v3/cp-service-revert-integ';
const PREFIX = '/cp-service-revert-integ';
const READ_ONLY_USERNAME = 'cpServiceRevertReadOnly';
const BACKGROUND = { kind: 'background' } as const;

describe('ChangeProposalService.revert', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  let readOnlyUser: IUserHasId;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpServiceRevertRequester',
      subscriber: 'cpServiceRevertSubscriber',
      other: 'cpServiceRevertOther',
    },
  });
  const { users } = kit;
  const Page = () => mongoose.model<PageDocument, PageModel>('Page');

  const keyOf = (proposal: ChangeProposalDocument, index: number): string => {
    const op = proposal.operations.find((o) => o.index === index);
    if (op == null) throw new Error(`operation ${index} not found`);
    return op.key;
  };

  const applyOriginal = async (
    operations: readonly CreateOperationInput[],
    options: Parameters<typeof kit.storeProposal>[1] = {},
  ): Promise<ChangeProposalDocument> => {
    const proposal = await kit.storeProposal(operations, options);
    await kit.newApplier().apply(proposal._id, BACKGROUND);
    await kit.waitForPageOperationsToFinish();
    return kit.reload(proposal._id);
  };

  const revisionBodyOf = async (pageId: string): Promise<string> => {
    const page = await kit.findPage(pageId);
    const revision = await prisma.revisions.findUnique({
      where: { id: page.revision?.toString() },
    });
    return revision?.body ?? '';
  };

  const createOwnerOnlyPage = async (owner: IUserHasId, label: string) => {
    const page = await crowi.pageService.create(
      kit.nextPath(label),
      'base body',
      owner,
      { grant: PageGrant.GRANT_OWNER },
    );
    await kit.waitForPageOperationsToFinish();
    return kit.findPage(page._id);
  };

  const countProposalsRevertOf = (proposalId: string) =>
    prisma.changeproposals.count({ where: { revertOf: proposalId } });

  const revertAndWait: ChangeProposalService['revert'] = async (...args) => {
    const result = await service.revert(...args);
    await kit.waitForPageOperationsToFinish();
    return result;
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    readOnlyUser = await mongoose.model<IUserHasId>('User').create({
      name: READ_ONLY_USERNAME,
      username: READ_ONLY_USERNAME,
      email: `${READ_ONLY_USERNAME}@example.com`,
      status: UserStatus.STATUS_ACTIVE,
      readOnly: true,
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
    kit.editingPageIds.clear();
    await kit.waitForPageOperationsToFinish();
    vi.restoreAllMocks();
    await configManager.updateConfigs(
      {
        'changeProposal:isEditEnabled': undefined,
        'changeProposal:isCreateEnabled': undefined,
        'changeProposal:isMoveEnabled': undefined,
        'changeProposal:maxProposalsPerUserPerDay': undefined,
      },
      { removeIfUndefined: true },
    );
    await configManager.updateConfigs({ 'app:changeProposalEnabled': true });
  });

  afterAll(async () => {
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
    await prisma.changeproposals.deleteMany({
      where: {
        requester: {
          in: [users.requester, users.other, readOnlyUser].map((u) =>
            u._id.toString(),
          ),
        },
      },
    });
    await mongoose.model('User').deleteMany({ username: READ_ONLY_USERNAME });
    await kit.tearDown();
  });

  describe('a revert by the requester', () => {
    it('reverts every applied operation through a revert proposal applied without an approval step', async () => {
      const edited = await kit.createPage('all-edit');
      const moved = await kit.createPage('all-move');
      const movedFrom = moved.path;
      const movedTo = kit.nextPath('all-moved-to');
      const createdPath = kit.nextPath('all-created');
      const original = await applyOriginal([
        kit.editInput(edited, 'proposed body'),
        { type: 'create', path: createdPath, body: 'created body' },
        {
          type: 'move',
          pageId: moved._id.toString(),
          fromPath: movedFrom,
          toPath: movedTo,
        },
      ]);
      const createdPageId = original.operations[1].resultPageId;
      if (createdPageId == null) throw new Error('create was not applied');
      const requestedAt = Date.now();

      const result = await revertAndWait(
        original._id,
        users.requester,
        'all-visible',
        BACKGROUND,
      );

      if (!result.ok) throw new Error(JSON.stringify(result.error));
      const { revertProposalId } = result.value;
      expect(revertProposalId).toEqual(expect.any(String));
      expect(result.value.operations).toEqual([
        { key: keyOf(original, 0), outcome: 'reverted' },
        { key: keyOf(original, 1), outcome: 'reverted' },
        { key: keyOf(original, 2), outcome: 'reverted' },
      ]);

      const revert = await kit.reload(revertProposalId ?? '');
      expect(revert).toMatchObject({
        entry: 'revert',
        revertOf: original._id,
        requester: users.requester._id.toString(),
        lifecycle: 'settled',
      });
      expect(revert.expiresAt).toBeUndefined();
      expect(revert.operations.map((op) => [op.type, op.status])).toEqual([
        ['edit', 'applied'],
        ['trash', 'applied'],
        ['move', 'applied'],
      ]);
      for (const op of revert.operations) {
        expect(op.approvedAt?.getTime()).toBeGreaterThanOrEqual(
          requestedAt - 1000,
        );
      }
      expect(revert.operations.map((op) => op.revertTarget)).toEqual(
        original.operations.map((op) => ({
          proposalId: original._id,
          operationKey: op.key,
        })),
      );

      const after = await kit.reload(original._id);
      expect(
        after.operations.map((op) => [op.status, op.revertedByProposalId]),
      ).toEqual([
        ['reverted', revertProposalId],
        ['reverted', revertProposalId],
        ['reverted', revertProposalId],
      ]);
      expect(await revisionBodyOf(edited._id.toString())).toBe('base body');
      expect((await kit.findPage(createdPageId)).path).toBe(
        `/trash${createdPath}`,
      );
      expect((await kit.findPage(moved._id)).path).toBe(movedFrom);
    });

    it('reverts a proposal that is already settled', async () => {
      const page = await kit.createPage('settled');
      const original = await applyOriginal([kit.editInput(page)]);
      expect(original.lifecycle).toBe('settled');

      const result = await revertAndWait(
        original._id,
        users.requester,
        [keyOf(original, 0)],
        BACKGROUND,
      );

      expect(result).toMatchObject({
        ok: true,
        value: {
          operations: [{ key: keyOf(original, 0), outcome: 'reverted' }],
        },
      });
      expect(await revisionBodyOf(page._id.toString())).toBe('base body');
    });

    it('reverts only the applied operations of an open proposal and refuses a chosen pending one', async () => {
      const applied = await kit.createPage('open-applied');
      const waiting = await kit.createPage('open-waiting');
      const original = await kit.storeProposal(
        [kit.editInput(applied), kit.editInput(waiting)],
        { approve: false },
      );
      await prisma.changeproposals.markApproved(
        original._id,
        users.requester._id.toString(),
        [keyOf(original, 0)],
        new Date(),
      );
      await kit.newApplier().apply(original._id, BACKGROUND);
      expect((await kit.reload(original._id)).lifecycle).toBe('open');

      const all = await revertAndWait(
        original._id,
        users.requester,
        'all-visible',
        BACKGROUND,
      );
      expect(all).toMatchObject({
        ok: true,
        value: {
          operations: [{ key: keyOf(original, 0), outcome: 'reverted' }],
        },
      });

      const chosenPending = await revertAndWait(
        original._id,
        users.requester,
        [keyOf(original, 1)],
        BACKGROUND,
      );
      expect(chosenPending).toEqual({
        ok: true,
        value: {
          operations: [
            {
              key: keyOf(original, 1),
              outcome: 'revert-refused',
              reason: 'not-revertible-state',
            },
          ],
        },
      });
      expect(
        (await kit.reload(original._id)).operations.map((op) => op.status),
      ).toEqual(['reverted', 'pending']);
    });

    it.each([
      true,
      false,
    ])('carries the per-page notification switch (%s) of the original over to the revert proposal', async (perPageNotifications) => {
      const page = await kit.createPage(`per-page-${perPageNotifications}`);
      const original = await applyOriginal([kit.editInput(page)], {
        perPageNotifications,
      });

      const result = await revertAndWait(
        original._id,
        users.other,
        'all-visible',
        BACKGROUND,
      );

      if (!result.ok) throw new Error(JSON.stringify(result.error));
      const revert = await kit.reload(result.value.revertProposalId ?? '');
      expect(revert.perPageNotifications).toBe(perPageNotifications);
    });

    it('records the revert on the route activity when triggered by a request', async () => {
      const page = await kit.createPage('request');
      const original = await applyOriginal([kit.editInput(page)]);
      const { activityId } = beginActivity({
        ip: TEST_IP,
        endpoint: TEST_ENDPOINT,
        userId: users.requester._id.toString(),
        username: users.requester.username,
        createdAt: new Date(),
      });

      const result = await revertAndWait(
        original._id,
        users.requester,
        'all-visible',
        { kind: 'request', activityId },
      );
      pendingActivityContext.clear(activityId);

      if (!result.ok) throw new Error(JSON.stringify(result.error));
      await vi.waitFor(
        async () => {
          const rows = await prisma.activities.findMany({
            where: { target: result.value.revertProposalId },
          });
          expect(rows).toEqual([
            expect.objectContaining({
              id: activityId,
              action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT,
            }),
          ]);
        },
        { timeout: 5000, interval: 50 },
      );
    });
  });

  describe('a revert by someone other than the requester', () => {
    it('reverts only the operations on pages the reverter can view and never mentions the others', async () => {
      const shared = await kit.createPage('partial-shared');
      const hidden = await createOwnerOnlyPage(users.requester, 'partial-own');
      const original = await applyOriginal([
        kit.editInput(shared),
        kit.editInput(hidden),
      ]);
      expect(original.operations.map((op) => op.status)).toEqual([
        'applied',
        'applied',
      ]);

      const result = await revertAndWait(
        original._id,
        users.other,
        'all-visible',
        BACKGROUND,
      );

      if (!result.ok) throw new Error(JSON.stringify(result.error));
      expect(result.value.operations).toEqual([
        { key: keyOf(original, 0), outcome: 'reverted' },
      ]);
      const revert = await kit.reload(result.value.revertProposalId ?? '');
      expect(revert.requester).toBe(users.other._id.toString());
      expect(revert.operations).toHaveLength(1);
      expect(
        (await kit.reload(original._id)).operations.map((op) => op.status),
      ).toEqual(['reverted', 'applied']);
      expect(await revisionBodyOf(hidden._id.toString())).not.toBe('base body');
    });

    it('drops a chosen operation the reverter cannot view exactly like an unknown key', async () => {
      const shared = await kit.createPage('drop-shared');
      const hidden = await createOwnerOnlyPage(users.requester, 'drop-own');
      const original = await applyOriginal([
        kit.editInput(shared),
        kit.editInput(hidden),
      ]);
      const before = await kit.reload(original._id);

      for (const keys of [[keyOf(original, 1)], ['no-such-key']]) {
        // biome-ignore lint/performance/noAwaitInLoops: each request is checked on its own
        await expect(
          revertAndWait(original._id, users.other, keys, BACKGROUND),
        ).resolves.toEqual({ ok: true, value: { operations: [] } });
      }
      expect(await countProposalsRevertOf(original._id)).toBe(0);
      expect(await kit.reload(original._id)).toEqual(before);
    });

    it('answers not-found when the reverter can view none of the operations', async () => {
      const hidden = await createOwnerOnlyPage(users.requester, 'none-own');
      const original = await applyOriginal([kit.editInput(hidden)]);

      await expect(
        service.revert(original._id, users.other, 'all-visible', BACKGROUND),
      ).resolves.toEqual({ ok: false, error: { code: 'not-found' } });
      expect(await countProposalsRevertOf(original._id)).toBe(0);
    });

    it.each([
      ['a missing proposal', new mongoose.Types.ObjectId().toString()],
      ['a malformed id', 'not-an-id'],
    ])('answers not-found for %s', async (_label, id) => {
      await expect(
        service.revert(id, users.other, 'all-visible', BACKGROUND),
      ).resolves.toEqual({ ok: false, error: { code: 'not-found' } });
    });

    it('leaves out an operation on a page only people with the link may view', async () => {
      const restricted = await crowi.pageService.create(
        kit.nextPath('with-link'),
        'base body',
        users.requester,
        { grant: PageGrant.GRANT_RESTRICTED },
      );
      await kit.waitForPageOperationsToFinish();
      const shared = await kit.createPage('with-link-shared');
      const original = await applyOriginal([
        kit.editInput(shared),
        kit.editInput(await kit.findPage(restricted._id)),
      ]);
      expect(original.operations.map((op) => op.status)).toEqual([
        'applied',
        'applied',
      ]);

      const result = await revertAndWait(
        original._id,
        users.other,
        'all-visible',
        BACKGROUND,
      );

      expect(result).toMatchObject({
        ok: true,
        value: {
          operations: [{ key: keyOf(original, 0), outcome: 'reverted' }],
        },
      });
      expect(
        (await kit.reload(original._id)).operations.map((op) => op.status),
      ).toEqual(['reverted', 'applied']);
    });
  });

  describe('who may revert and under which settings', () => {
    it.each([
      ['a guest', () => null],
      ['a read-only user', () => readOnlyUser],
    ])('rejects %s', async (_label, userOf) => {
      const page = await kit.createPage('guest');
      const original = await applyOriginal([kit.editInput(page)]);

      await expect(
        service.revert(original._id, userOf(), 'all-visible', BACKGROUND),
      ).resolves.toEqual({ ok: false, error: { code: 'user-not-allowed' } });
      expect(await countProposalsRevertOf(original._id)).toBe(0);
    });

    it('reverts while the feature and every operation type are disabled', async () => {
      const page = await kit.createPage('disabled');
      const original = await applyOriginal([kit.editInput(page)]);
      await configManager.updateConfigs({
        'app:changeProposalEnabled': false,
        'changeProposal:isEditEnabled': false,
        'changeProposal:isCreateEnabled': false,
        'changeProposal:isMoveEnabled': false,
      });

      const result = await revertAndWait(
        original._id,
        users.requester,
        'all-visible',
        BACKGROUND,
      );

      expect(result).toMatchObject({
        ok: true,
        value: {
          operations: [{ key: keyOf(original, 0), outcome: 'reverted' }],
        },
      });
      expect(await revisionBodyOf(page._id.toString())).toBe('base body');
    });

    it('reverts when the daily cap already refuses the reverter a new proposal', async () => {
      const page = await kit.createPage('capped');
      const original = await applyOriginal([kit.editInput(page)]);
      await configManager.updateConfigs({
        'changeProposal:maxProposalsPerUserPerDay': 1,
      });
      await expect(
        service.createProposal({
          requester: users.requester,
          entry: 'ai-chat',
          operations: [
            { type: 'create', path: kit.nextPath('capped-new'), body: 'b' },
          ],
        }),
      ).resolves.toEqual({
        ok: false,
        error: { code: 'daily-limit-reached', max: 1 },
      });

      const result = await revertAndWait(
        original._id,
        users.requester,
        'all-visible',
        BACKGROUND,
      );

      expect(result).toMatchObject({
        ok: true,
        value: {
          operations: [{ key: keyOf(original, 0), outcome: 'reverted' }],
        },
      });
      expect(await revisionBodyOf(page._id.toString())).toBe('base body');
    });
  });

  describe('outcomes decided while applying the revert', () => {
    it('skips an operation on a page being edited and leaves the original applied for a later request', async () => {
      const page = await kit.createPage('being-edited');
      const original = await applyOriginal([kit.editInput(page)]);
      kit.editingPageIds.add(page._id.toString());

      const result = await revertAndWait(
        original._id,
        users.requester,
        'all-visible',
        BACKGROUND,
      );

      if (!result.ok) throw new Error(JSON.stringify(result.error));
      expect(result.value.operations).toEqual([
        {
          key: keyOf(original, 0),
          outcome: 'skipped',
          reason: 'page-being-edited',
        },
      ]);
      const revert = await kit.reload(result.value.revertProposalId ?? '');
      expect(revert.lifecycle).toBe('settled');
      expect((await kit.reload(original._id)).operations[0].status).toBe(
        'applied',
      );

      kit.editingPageIds.clear();
      await expect(
        revertAndWait(original._id, users.requester, 'all-visible', BACKGROUND),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          operations: [{ key: keyOf(original, 0), outcome: 'reverted' }],
        },
      });
    });

    it('does not revert the same operation twice', async () => {
      const page = await kit.createPage('twice');
      const original = await applyOriginal([kit.editInput(page)]);
      const first = await revertAndWait(
        original._id,
        users.requester,
        'all-visible',
        BACKGROUND,
      );
      expect(first.ok).toBe(true);

      await expect(
        revertAndWait(original._id, users.other, 'all-visible', BACKGROUND),
      ).resolves.toEqual({ ok: true, value: { operations: [] } });
      await expect(
        revertAndWait(
          original._id,
          users.requester,
          [keyOf(original, 0)],
          BACKGROUND,
        ),
      ).resolves.toEqual({
        ok: true,
        value: {
          operations: [
            {
              key: keyOf(original, 0),
              outcome: 'revert-refused',
              reason: 'not-revertible-state',
            },
          ],
        },
      });
      expect(await countProposalsRevertOf(original._id)).toBe(1);
      expect(await revisionBodyOf(page._id.toString())).toBe('base body');
    });
  });
});
