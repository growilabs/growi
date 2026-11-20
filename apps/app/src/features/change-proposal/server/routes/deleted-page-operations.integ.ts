import type { IUserHasId } from '@growi/core';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { prisma } from '~/utils/prisma';

import type {
  ChangeProposalDocument,
  ChangeProposalSummaryView,
  ChangeProposalView,
} from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from '../services/change-proposal-service';
import { createApplierTestKit } from '../services/proposal-applier.test-kit';
import { createChangeProposalRouter } from '.';

const TEST_IP = '10.0.0.185';
const PREFIX = '/cp-deleted-page-operations-integ';
const MOUNT_PATH = '/_api/v3/change-proposals';
const BACKGROUND = { kind: 'background' } as const;

const leakedOf = (value: unknown, secrets: readonly string[]): string[] => {
  const json = JSON.stringify(value);
  return secrets.filter((secret) => json.includes(secret));
};

/**
 * Operations whose page no longer exists: who gets them, with which path, and
 * that a revert never picks them up for anyone but the requester.
 * Roles: `requester` asks for the changes, `other` reverts them, and
 * `subscriber` is a third party who is neither.
 */
describe('operations on pages that no longer exist', () => {
  let crowi: Crowi;
  let app: express.Application;
  let service: ChangeProposalService;
  let currentUser: IUserHasId | undefined;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpDeletedOpsRequester',
      subscriber: 'cpDeletedOpsThirdParty',
      other: 'cpDeletedOpsReverter',
    },
  });
  const { users } = kit;

  const asUser = (user: IUserHasId) => {
    currentUser = user;
  };

  const getProposal = (id: string) => request(app).get(`${MOUNT_PATH}/${id}`);
  const listMine = () =>
    request(app).get(`${MOUNT_PATH}/mine`).query({ limit: 50 });
  const listApplied = () =>
    request(app).get(`${MOUNT_PATH}/applied`).query({ limit: 50 });
  const revertAll = (id: string) =>
    request(app)
      .post(`${MOUNT_PATH}/${id}/revert`)
      .set('X-Forwarded-For', TEST_IP)
      .send({});

  const viewAs = async (
    user: IUserHasId,
    id: string,
  ): Promise<ChangeProposalView> => {
    asUser(user);
    const res = await getProposal(id);
    expect(res.status).toBe(200);
    return res.body.proposal;
  };

  const summaryIn = (
    items: readonly ChangeProposalSummaryView[],
    id: string,
  ): ChangeProposalSummaryView | undefined =>
    items.find((item) => item.id === id);

  const appliedSummariesFor = async (
    user: IUserHasId,
  ): Promise<ChangeProposalSummaryView[]> => {
    asUser(user);
    const res = await listApplied();
    expect(res.status).toBe(200);
    return res.body.items;
  };

  const mySummariesFor = async (
    user: IUserHasId,
  ): Promise<ChangeProposalSummaryView[]> => {
    asUser(user);
    const res = await listMine();
    expect(res.status).toBe(200);
    return res.body.items;
  };

  const applyAll = async (
    operations: readonly CreateOperationInput[],
  ): Promise<ChangeProposalDocument> => {
    const proposal = await kit.storeProposal(operations);
    await kit.newApplier().apply(proposal._id, BACKGROUND);
    await kit.waitForPageOperationsToFinish();
    const applied = await kit.reload(proposal._id);
    expect(applied.operations.map((op) => op.status)).toEqual(
      operations.map(() => 'applied'),
    );
    return applied;
  };

  const revertAs = async (
    proposalId: string,
    user: IUserHasId,
  ): Promise<ChangeProposalDocument> => {
    const result = await service.revert(
      proposalId,
      user,
      'all-visible',
      BACKGROUND,
    );
    await kit.waitForPageOperationsToFinish();
    if (!result.ok || result.value.revertProposalId == null) {
      throw new Error(`nothing was reverted: ${JSON.stringify(result)}`);
    }
    return kit.reload(result.value.revertProposalId);
  };

  const createdOf = (proposal: ChangeProposalDocument) => {
    const op = proposal.operations.find((o) => o.type === 'create');
    if (op?.type !== 'create' || op.resultPageId == null) {
      throw new Error('the proposal has no applied create');
    }
    return { key: op.key, path: op.path, pageId: op.resultPageId };
  };

  const statusOf = async (proposalId: string, key: string) =>
    kit.operationOf(await kit.reload(proposalId), key).status;

  const deletePageCompletely = async (pageId: string): Promise<void> => {
    await crowi.pageService.deleteCompletely(
      await kit.findPage(pageId),
      users.other,
      {},
      false,
      false,
      { ip: TEST_IP },
    );
    await kit.waitForPageOperationsToFinish();
    expect(await mongoose.model('Page').exists({ _id: pageId })).toBeNull();
  };

  // A create the requester asked for, applied, then reverted by `other`.
  const createRevertedByOther = async (label: string) => {
    const original = await applyAll([
      { type: 'create', path: kit.nextPath(label), body: '作った本文' },
    ]);
    const revert = await revertAs(original._id, users.other);
    return { original, revert, created: createdOf(original) };
  };

  // A create and an edit of a page everyone can see, all reverted by `other`.
  const createAndEditRevertedByOther = async (label: string) => {
    const edited = await kit.createPage(`${label}-edited`);
    const original = await applyAll([
      { type: 'create', path: kit.nextPath(`${label}-created`), body: '本文' },
      kit.editInput(edited, '提案した本文'),
    ]);
    const revert = await revertAs(original._id, users.other);
    expect(revert.operations.map((op) => [op.type, op.status])).toEqual([
      ['delete-completely', 'applied'],
      ['edit', 'applied'],
    ]);
    return { original, revert, edited, created: createdOf(original) };
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
    service = createChangeProposalService(crowi, {
      applier: kit.newApplier(),
    });

    const responseHelpers: { response: Record<string, unknown> } = {
      response: {},
    };
    addCustomFunctionToResponse(responseHelpers);
    app = express();
    // Activity rows carry req.ip; the suite's rows are found and removed by TEST_IP.
    app.set('trust proxy', true);
    app.use(express.json());
    app.use((req: express.Request & { user?: IUserHasId }, res, next) => {
      Object.assign(res, responseHelpers.response);
      if (currentUser != null) {
        req.user = currentUser;
      }
      next();
    });
    app.use(MOUNT_PATH, createChangeProposalRouter(crowi, { service }));
  }, 120_000);

  afterEach(async () => {
    kit.editingPageIds.clear();
    await kit.waitForPageOperationsToFinish();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    const ids = (
      await prisma.changeproposals.findMany({
        where: {
          requester: {
            in: [users.requester, users.other].map((u) => u._id.toString()),
          },
        },
        select: { id: true },
      })
    ).map((p) => p.id);
    await InAppNotification.deleteMany({ target: { $in: ids } });
    await prisma.activities.deleteMany({ where: { target: { in: ids } } });
    await prisma.changeproposals.deleteMany({ where: { id: { in: ids } } });
    await prisma.pageredirects.deleteMany({
      where: { fromPath: { startsWith: PREFIX } },
    });
    await kit.tearDown();
  }, 60_000);

  describe('(1) the reverter reading the original whose create they reverted', () => {
    it('gets the create as reverted, with its path and the revert proposal, in the view and in the applied list', async () => {
      const { original, revert, created } =
        await createRevertedByOther('reverter-reads');

      const view = await viewAs(users.other, original._id);

      expect(view.status).toBe('reverted');
      expect(view.operations).toEqual([
        expect.objectContaining({
          key: created.key,
          type: 'create',
          status: 'reverted',
          path: created.path,
          revertedByProposalId: revert._id,
        }),
      ]);
      expect(view.operations[0]).not.toHaveProperty('page');
      expect(
        summaryIn(await appliedSummariesFor(users.other), original._id)?.pages,
      ).toEqual([{ id: created.pageId, path: created.path }]);
    });
  });

  describe('(2) the original requester reading a revert that only deleted their created page', () => {
    it('gets the delete-completely with the created path and no revertability, in the view and in the applied list', async () => {
      const { revert, created } = await createRevertedByOther('original-reads');
      const [deleteOp] = revert.operations;

      const view = await viewAs(users.requester, revert._id);

      expect(view.isRequester).toBe(false);
      expect(view.operations).toEqual([
        expect.objectContaining({
          key: deleteOp.key,
          type: 'delete-completely',
          status: 'applied',
          path: created.path,
        }),
      ]);
      expect(view.operations[0]).not.toHaveProperty('revertability');
      expect(view.operations[0]).not.toHaveProperty('page');
      expect(
        summaryIn(await appliedSummariesFor(users.requester), revert._id)
          ?.pages,
      ).toEqual([{ id: created.pageId, path: created.path }]);
    });
  });

  describe('(3) reverting everything visible never touches an operation shown only to a revert counterpart', () => {
    it('answers the original requester 404 for a revert that only deleted their created page, leaving it applied', async () => {
      const { revert } = await createRevertedByOther('original-reverts');
      const [deleteOp] = revert.operations;

      asUser(users.requester);
      const res = await revertAll(revert._id);

      expect(res.status).toBe(404);
      expect(res.body.errors[0].code).toBe('notfound');
      expect(await statusOf(revert._id, deleteOp.key)).toBe('applied');
    });

    it('answers the reverter 404 for the original whose only create they reverted, leaving it reverted', async () => {
      const { original, created } =
        await createRevertedByOther('reverter-reverts');

      asUser(users.other);
      const res = await revertAll(original._id);

      expect(res.status).toBe(404);
      expect(res.body.errors[0].code).toBe('notfound');
      expect(await statusOf(original._id, created.key)).toBe('reverted');
    });

    it('reverts the other visible operations but leaves the gone page out of the result and unchanged', async () => {
      const { revert } = await createAndEditRevertedByOther('mixed-reverts');
      const [deleteOp, editOp] = revert.operations;

      asUser(users.requester);
      const res = await revertAll(revert._id);
      await kit.waitForPageOperationsToFinish();

      expect(res.status).toBe(200);
      expect(res.body.result.operations).toEqual([
        { key: editOp.key, outcome: 'reverted' },
      ]);
      expect(await statusOf(revert._id, deleteOp.key)).toBe('applied');
      expect(await statusOf(revert._id, editOp.key)).toBe('reverted');
    });
  });

  describe('(4) the path of an operation whose page a person deleted completely', () => {
    it('returns an edit and a move with the path recorded when applied, in the view and in my list', async () => {
      const edited = await kit.createPage('edited-then-deleted');
      const moved = await kit.createPage('moved-then-deleted');
      const movedTo = kit.nextPath('moved-to');
      const proposal = await applyAll([
        kit.editInput(edited, '提案した本文'),
        {
          type: 'move',
          pageId: moved._id.toString(),
          fromPath: moved.path,
          toPath: movedTo,
        },
      ]);
      await deletePageCompletely(edited._id.toString());
      await deletePageCompletely(moved._id.toString());

      const view = await viewAs(users.requester, proposal._id);

      expect(view.operations).toEqual([
        expect.objectContaining({
          type: 'edit',
          status: 'applied',
          path: edited.path,
        }),
        expect.objectContaining({
          type: 'move',
          fromPath: moved.path,
          toPath: movedTo,
        }),
      ]);
      expect(
        summaryIn(await mySummariesFor(users.requester), proposal._id)?.pages,
      ).toEqual([
        { id: edited._id.toString(), path: edited.path },
        { id: moved._id.toString(), path: movedTo },
      ]);
    });

    it('lists an edit applied before paths were recorded by its page id alone', async () => {
      const edited = await kit.createPage('edited-no-recorded-path');
      const proposal = await applyAll([kit.editInput(edited, '本文')]);
      const [editOp] = proposal.operations;
      await prisma.changeproposals.update({
        where: { id: proposal._id },
        data: {
          operations: {
            updateMany: { where: { key: editOp.key }, data: { path: null } },
          },
        },
      });
      expect(
        kit.operationOf(await kit.reload(proposal._id), editOp.key),
      ).not.toHaveProperty('appliedPagePath');
      await deletePageCompletely(edited._id.toString());

      const view = await viewAs(users.requester, proposal._id);

      expect(view.operations[0]).not.toHaveProperty('path');
      expect(
        summaryIn(await mySummariesFor(users.requester), proposal._id)?.pages,
      ).toEqual([{ id: edited._id.toString() }]);
    });

    it('returns the created path on a delete-completely whose page is still there', async () => {
      const original = await applyAll([
        { type: 'create', path: kit.nextPath('still-there'), body: '本文' },
      ]);
      const created = createdOf(original);
      kit.editingPageIds.add(created.pageId);
      const revert = await revertAs(original._id, users.requester);
      const [deleteOp] = revert.operations;
      expect(deleteOp.status).toBe('skipped');

      const view = await viewAs(users.requester, revert._id);

      expect(view.operations).toEqual([
        expect.objectContaining({
          type: 'delete-completely',
          status: 'skipped',
          page: { id: created.pageId, path: created.path },
          path: created.path,
        }),
      ]);
    });
  });

  describe('a linked proposal whose only operation is on a gone page', () => {
    it('links the reverter, reading the original, to the follow-up whose create they reverted', async () => {
      const edited = await kit.createPage('linked-base-edited');
      const original = await applyAll([kit.editInput(edited, '提案した本文')]);
      const [baseEdit] = original.operations;
      const followUp = await kit.storeProposal(
        [
          {
            type: 'create',
            path: kit.nextPath('linked-created'),
            body: '本文',
          },
        ],
        {
          basedOn: {
            proposalId: original._id,
            relation: 'follow-up',
            operationKeys: [baseEdit.key],
          },
        },
      );
      await kit.newApplier().apply(followUp._id, BACKGROUND);
      await kit.waitForPageOperationsToFinish();
      await revertAs(followUp._id, users.other);

      const view = await viewAs(users.other, original._id);

      expect(view.operations).toEqual([
        expect.objectContaining({
          key: baseEdit.key,
          linkedProposals: [
            { proposalId: followUp._id, relation: 'follow-up' },
          ],
        }),
      ]);
      // Negative control: the third party is no counterpart and gets no link.
      const thirdPartyView = await viewAs(users.subscriber, original._id);
      expect(thirdPartyView.operations[0]).not.toHaveProperty(
        'linkedProposals',
      );
    });
  });

  describe('(5) a third party who is neither the requester nor a revert counterpart', () => {
    it('reads the original and the revert of a gone page as not found and never sees them in the applied list', async () => {
      const { original, revert } = await createRevertedByOther('third-party');

      asUser(users.subscriber);
      const responses = await Promise.all([
        getProposal(original._id),
        getProposal(revert._id),
        getProposal(new mongoose.Types.ObjectId().toString()),
      ]);

      for (const res of responses) {
        expect(res.status).toBe(404);
        expect(res.body.errors[0].code).toBe('notfound');
      }
      const ids = (await appliedSummariesFor(users.subscriber)).map(
        (item) => item.id,
      );
      expect(ids).not.toContain(original._id);
      expect(ids).not.toContain(revert._id);
    });

    it('never learns the path or the id of the gone page from proposals they can otherwise read', async () => {
      const { original, revert, edited, created } =
        await createAndEditRevertedByOther('third-party-mixed');
      const secrets = [created.path, created.pageId, created.key];

      const originalView = await viewAs(users.subscriber, original._id);
      const revertView = await viewAs(users.subscriber, revert._id);
      const summaries = await appliedSummariesFor(users.subscriber);

      expect(originalView.operations.map((op) => op.type)).toEqual(['edit']);
      expect(revertView.operations.map((op) => op.type)).toEqual(['edit']);
      expect(summaryIn(summaries, original._id)?.pages).toEqual([
        { id: edited._id.toString(), path: edited.path },
      ]);
      expect(summaryIn(summaries, revert._id)?.pages).toEqual([
        { id: edited._id.toString(), path: edited.path },
      ]);
      expect(
        leakedOf(
          [
            originalView,
            revertView,
            summaryIn(summaries, original._id),
            summaryIn(summaries, revert._id),
          ],
          secrets,
        ),
      ).toEqual([]);
    });
  });
});
