import { randomUUID } from 'node:crypto';
import type { IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import UserGroup from '~/server/models/user-group';
import { prisma } from '~/utils/prisma';

import type {
  BasedOn,
  ChangeProposalDocument,
  ChangeProposalView,
  OperationView,
  ReviewerRef,
  ReviewRecord,
} from '../../interfaces';
import type { ViewerIdentity } from '../domain';
import type { CreateOperationInput } from '../models/change-proposal-types';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import type { ServiceResult } from './change-proposal-service-types';
import { createApplierTestKit } from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.172';
const PREFIX = '/cp-service-get-reviewer-values-integ';
const BACKGROUND = { kind: 'background' } as const;
const GROUP_NAME = 'cpGetReviewerValuesGroup';
const NOT_FOUND = { ok: false, error: { code: 'not-found' } };
const PURPOSE = '<script>alert("purpose")</script> **as typed**';

// Markers that may only reach the viewers allowed to read them.
const HIDDEN_OP_COMMENT = 'HIDDEN-OP-COMMENT';
const WHOLE_REJECT_COMMENT = 'WHOLE-REJECT-COMMENT';
const SUPERSEDED_COMMENT = 'SUPERSEDED-COMMENT';
const SHARED_ABSTAIN_COMMENT = 'SHARED-ABSTAIN-COMMENT';
const LOST_PAGE_COMMENT = 'LOST-PAGE-COMMENT';

describe('ChangeProposalService.getForViewer: reviewer values and decision records', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  let groupId: string;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpGetReviewerValuesRequester',
      subscriber: 'cpGetReviewerValuesReviewer',
      other: 'cpGetReviewerValuesOther',
    },
  });
  const { users } = kit;
  const Page = () => mongoose.model<PageDocument, PageModel>('Page');

  const viewOf = (result: ServiceResult<ChangeProposalView>) => {
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    return result.value;
  };

  const opOf = (view: ChangeProposalView, key: string): OperationView => {
    const op = view.operations.find((o) => o.key === key);
    if (op == null) throw new Error(`operation ${key} not in the view`);
    return op;
  };

  const idOf = (user: IUserHasId): string => user._id.toString();

  const identityOf = (user: IUserHasId): ViewerIdentity => ({
    userId: idOf(user),
    userGroupIds: new Set(),
    externalUserGroupIds: new Set(),
  });

  const summaryOf = (user: IUserHasId) => ({
    id: idOf(user),
    username: user.username,
    name: user.name,
  });

  const userReviewer = (user: IUserHasId): ReviewerRef => ({
    kind: 'user',
    id: idOf(user),
    addedBy: idOf(users.requester),
    addedAt: new Date(),
  });

  const at = (secondsAgo: number): Date =>
    new Date(Date.now() - secondsAgo * 1000);

  // Seeds the stored records as they stand, independent of who may write them.
  const seedReviews = (proposalId: string, reviews: readonly ReviewRecord[]) =>
    prisma.changeproposals.update({
      where: { id: proposalId },
      data: { reviews: { push: [...reviews] } },
    });

  const approveAs = async (
    proposal: ChangeProposalDocument,
    user: IUserHasId,
    keys: readonly string[],
  ) => {
    const result = await prisma.changeproposals.markApproved(
      proposal._id,
      {
        approver: identityOf(user),
        channel: 'api',
        decisionToken: randomUUID(),
      },
      keys,
      new Date(),
    );
    expect(result).toMatchObject({ ok: true });
  };

  // Viewable by the requester alone.
  const hiddenPage = async (label: string) => {
    const page = await crowi.pageService.create(
      kit.nextPath(label),
      'base body',
      users.requester,
      { grant: PageGrant.GRANT_OWNER },
    );
    await kit.waitForPageOperationsToFinish();
    return kit.findPage(page._id);
  };

  const pendingProposal = (
    operations: readonly CreateOperationInput[],
    options: {
      readonly reviewers: readonly ReviewerRef[];
      readonly basedOn?: BasedOn;
      readonly purpose?: string;
    },
  ) => kit.storeProposal(operations, { approve: false, ...options });

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    service = createChangeProposalService(crowi, {
      applier: kit.newApplier(),
    });
    groupId = (await UserGroup.create({ name: GROUP_NAME }))._id.toString();
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
    await prisma.changeproposals.deleteMany({
      where: { requester: idOf(users.requester) },
    });
    await UserGroup.deleteMany({ _id: groupId });
    await Page().deleteMany({ path: new RegExp(`^${PREFIX}(/|$)`) });
    await kit.tearDown();
  });

  // A pending proposal: an edit and a create the reviewer may view, an edit only
  // the requester may view, with decision records on all of them and the whole.
  const pendingFixture = async (label: string) => {
    const shared = await kit.createPage(`${label}-shared`);
    const hidden = await hiddenPage(`${label}-hidden`);
    const proposal = await pendingProposal(
      [
        kit.editInput(shared, 'shared proposed body'),
        kit.editInput(hidden, 'hidden proposed body'),
        { type: 'create', path: `${shared.path}/child`, body: 'child body' },
      ],
      {
        reviewers: [
          userReviewer(users.subscriber),
          userReviewer(users.other),
          {
            kind: 'user-group',
            id: groupId,
            addedBy: idOf(users.subscriber),
            addedAt: at(30),
            removedBy: idOf(users.subscriber),
            removedAt: at(20),
          },
        ],
        purpose: PURPOSE,
      },
    );
    const [sharedKey, hiddenKey, createKey] = proposal.operations.map(
      (op) => op.key,
    );
    await seedReviews(proposal._id, [
      {
        kind: 'reject',
        operationKey: sharedKey,
        by: idOf(users.subscriber),
        at: at(10),
        comment: SUPERSEDED_COMMENT,
        channel: 'ui',
      },
      {
        kind: 'abstain',
        operationKey: sharedKey,
        by: idOf(users.subscriber),
        at: at(5),
        comment: SHARED_ABSTAIN_COMMENT,
        channel: 'ui',
      },
      {
        kind: 'reject',
        operationKey: hiddenKey,
        by: idOf(users.other),
        at: at(5),
        comment: HIDDEN_OP_COMMENT,
        channel: 'ui',
      },
      {
        kind: 'reject',
        by: idOf(users.subscriber),
        at: at(4),
        comment: WHOLE_REJECT_COMMENT,
        channel: 'ui',
      },
    ]);
    await approveAs(proposal, users.subscriber, [sharedKey]);
    await approveAs(proposal, users.requester, [hiddenKey]);
    return { proposal, shared, hidden, sharedKey, hiddenKey, createKey };
  };

  describe('a reviewer', () => {
    it('gets the purpose as stored and the reviewers with names, never the whole-proposal rejections (Req 15.10, 17.8, 19.1, 19.7)', async () => {
      const { proposal } = await pendingFixture('reviewer-header');

      const view = viewOf(
        await service.getForViewer(proposal._id, users.subscriber),
      );

      expect(view.purpose).toBe(PURPOSE);
      expect(view.reviewers).toEqual([
        expect.objectContaining({
          kind: 'user',
          id: idOf(users.subscriber),
          name: users.subscriber.username,
          addedBy: summaryOf(users.requester),
        }),
        expect.objectContaining({ kind: 'user', id: idOf(users.other) }),
        expect.objectContaining({
          kind: 'user-group',
          id: groupId,
          name: GROUP_NAME,
          removedBy: summaryOf(users.subscriber),
        }),
      ]);
      expect(view).not.toHaveProperty('wholeRejections');
      expect(view).not.toHaveProperty('requesterState');
    });

    it('gets the body, the base freshness and the rank on the decision targets only (Req 19.2)', async () => {
      const { proposal, sharedKey, createKey } =
        await pendingFixture('reviewer-values');

      const view = viewOf(
        await service.getForViewer(proposal._id, users.subscriber),
      );

      expect(view.operations.map((op) => op.key)).toEqual([
        sharedKey,
        createKey,
      ]);
      expect(opOf(view, sharedKey)).toMatchObject({
        proposedBody: 'shared proposed body',
        baseIsLatest: true,
        order: 0,
      });
      expect(opOf(view, createKey)).toMatchObject({
        proposedBody: 'child body',
        order: 1,
      });
    });

    it('reads a base revision that has moved on as not the latest (Req 19.2)', async () => {
      const page = await kit.createPage('reviewer-moved-base');
      const proposal = await pendingProposal([kit.editInput(page)], {
        reviewers: [userReviewer(users.subscriber)],
      });
      await crowi.pageService.updatePage(
        await kit.findPage(page._id),
        'edited by a human',
        'base body',
        users.other,
        {},
      );

      const view = viewOf(
        await service.getForViewer(proposal._id, users.subscriber),
      );

      expect(view.operations[0]?.baseIsLatest).toBe(false);
    });

    it('gets the latest decision per person and the approval on the operations they see only (Req 17.4, 17.8, 19.7)', async () => {
      const { proposal, sharedKey } = await pendingFixture('reviewer-records');

      const view = viewOf(
        await service.getForViewer(proposal._id, users.subscriber),
      );

      const sharedOp = opOf(view, sharedKey);
      expect(sharedOp.abstentions).toEqual([
        expect.objectContaining({
          by: summaryOf(users.subscriber),
          comment: SHARED_ABSTAIN_COMMENT,
        }),
      ]);
      expect(sharedOp).not.toHaveProperty('rejections');
      expect(sharedOp.approval).toMatchObject({
        by: summaryOf(users.subscriber),
        channel: 'api',
        byRequester: false,
      });
    });

    it('learns nothing of the operations on pages they may not view (Req 19.6, 19.7)', async () => {
      const { proposal, hidden, hiddenKey } =
        await pendingFixture('reviewer-leak');

      const serialized = JSON.stringify(
        viewOf(await service.getForViewer(proposal._id, users.subscriber)),
      );

      for (const secret of [
        hidden.path,
        hidden._id.toString(),
        hiddenKey,
        'hidden proposed body',
        HIDDEN_OP_COMMENT,
        WHOLE_REJECT_COMMENT,
        SUPERSEDED_COMMENT,
        '@example.com',
      ]) {
        expect(serialized).not.toContain(secret);
      }
    });
  });

  describe('the requester', () => {
    it('gets every decision record, the whole-proposal rejections and who approved, including themselves (Req 16.8, 17.8)', async () => {
      const { proposal, hiddenKey } = await pendingFixture('requester-records');

      const view = viewOf(
        await service.getForViewer(proposal._id, users.requester),
      );

      expect(view.purpose).toBe(PURPOSE);
      expect(view.reviewers).toHaveLength(3);
      expect(view.wholeRejections).toEqual([
        expect.objectContaining({
          by: summaryOf(users.subscriber),
          comment: WHOLE_REJECT_COMMENT,
        }),
      ]);
      expect(opOf(view, hiddenKey)).toMatchObject({
        rejections: [
          expect.objectContaining({
            by: summaryOf(users.other),
            comment: HIDDEN_OP_COMMENT,
          }),
        ],
        approval: { by: summaryOf(users.requester), byRequester: true },
      });
      expect(JSON.stringify(view)).not.toContain('@example.com');
    });

    it('learns nothing of an operation on a page they may no longer view, even what a reviewer recorded on it (Req 17.8, 19.6)', async () => {
      const shared = await kit.createPage('requester-leak-shared');
      const created = await crowi.pageService.create(
        kit.nextPath('requester-leak-hidden'),
        'base body',
        users.other,
        { grant: PageGrant.GRANT_OWNER },
      );
      await kit.waitForPageOperationsToFinish();
      const lost = await kit.findPage(created._id);
      const proposal = await pendingProposal(
        [kit.editInput(shared), kit.editInput(lost)],
        { reviewers: [userReviewer(users.other)] },
      );
      const [sharedKey, lostKey] = proposal.operations.map((op) => op.key);
      await seedReviews(proposal._id, [
        {
          kind: 'reject',
          operationKey: lostKey,
          by: idOf(users.other),
          at: at(5),
          comment: LOST_PAGE_COMMENT,
          channel: 'ui',
        },
      ]);
      await approveAs(proposal, users.other, [lostKey]);

      const view = viewOf(
        await service.getForViewer(proposal._id, users.requester),
      );

      expect(view.operations.map((op) => op.key)).toEqual([sharedKey]);
      const serialized = JSON.stringify(view);
      for (const secret of [
        lost.path,
        lost._id.toString(),
        lostKey,
        LOST_PAGE_COMMENT,
      ]) {
        expect(serialized).not.toContain(secret);
      }
    });
  });

  describe('a viewer who is neither the requester nor a reviewer', () => {
    it('gets the applied operations without any purpose, reviewer or decision record (Req 17.8, 19.10)', async () => {
      const shared = await kit.createPage('other-shared');
      const hidden = await hiddenPage('other-hidden');
      const proposal = await pendingProposal(
        [kit.editInput(shared), kit.editInput(hidden)],
        { reviewers: [userReviewer(users.subscriber)], purpose: PURPOSE },
      );
      const [sharedKey, hiddenKey] = proposal.operations.map((op) => op.key);
      await seedReviews(proposal._id, [
        {
          kind: 'reject',
          operationKey: sharedKey,
          by: idOf(users.subscriber),
          at: at(5),
          comment: SHARED_ABSTAIN_COMMENT,
          channel: 'ui',
        },
        {
          kind: 'reject',
          operationKey: hiddenKey,
          by: idOf(users.subscriber),
          at: at(5),
          comment: HIDDEN_OP_COMMENT,
          channel: 'ui',
        },
        {
          kind: 'reject',
          by: idOf(users.subscriber),
          at: at(4),
          comment: WHOLE_REJECT_COMMENT,
          channel: 'ui',
        },
      ]);
      await approveAs(proposal, users.subscriber, [sharedKey]);
      await kit.newApplier().apply(proposal._id, BACKGROUND);
      await kit.waitForPageOperationsToFinish();

      const forOther = viewOf(
        await service.getForViewer(proposal._id, users.other),
      );
      const forReviewer = viewOf(
        await service.getForViewer(proposal._id, users.subscriber),
      );

      expect(forOther.operations.map((op) => op.key)).toEqual([sharedKey]);
      const serialized = JSON.stringify(forOther);
      for (const secret of [
        hidden.path,
        hiddenKey,
        PURPOSE,
        SHARED_ABSTAIN_COMMENT,
        HIDDEN_OP_COMMENT,
        WHOLE_REJECT_COMMENT,
        users.subscriber.username,
        '"approval"',
        '"reviewers"',
        '"order"',
      ]) {
        expect(serialized).not.toContain(secret);
      }
      // The same applied operation carries its records for a reviewer.
      expect(opOf(forReviewer, sharedKey)).toMatchObject({
        status: 'applied',
        approval: { by: summaryOf(users.subscriber) },
        rejections: [
          expect.objectContaining({ comment: SHARED_ABSTAIN_COMMENT }),
        ],
      });
    });
  });

  describe('links to follow-ups, reworks and the base', () => {
    it('decides each linked proposal by the role the viewer has in it, and drops one with no operation they may view (Req 19.4, 19.6)', async () => {
      const base = await kit.createPage('links-base');
      const visible = await kit.createPage('links-visible');
      const hidden = await hiddenPage('links-hidden');
      const main = await pendingProposal([kit.editInput(base)], {
        reviewers: [userReviewer(users.subscriber)],
      });
      const basedOn: BasedOn = {
        proposalId: main._id,
        relation: 'follow-up',
        operationKeys: [main.operations[0].key],
      };
      const asReviewer = await pendingProposal([kit.editInput(visible)], {
        reviewers: [userReviewer(users.subscriber)],
        basedOn,
      });
      const asOther = await pendingProposal([kit.editInput(visible)], {
        reviewers: [userReviewer(users.other)],
        basedOn,
      });
      const hiddenFromReviewer = await pendingProposal(
        [kit.editInput(hidden)],
        { reviewers: [userReviewer(users.subscriber)], basedOn },
      );
      const findByIdsAndViewer = vi.spyOn(Page(), 'findByIdsAndViewer');

      const view = viewOf(
        await service.getForViewer(main._id, users.subscriber),
      );

      expect(view.operations[0]?.linkedProposals).toEqual([
        { proposalId: asReviewer._id, relation: 'follow-up' },
      ]);
      const serialized = JSON.stringify(view);
      expect(serialized).not.toContain(asOther._id);
      expect(serialized).not.toContain(hiddenFromReviewer._id);
      expect(findByIdsAndViewer).toHaveBeenCalledTimes(1);
    });

    it('narrows the link back to the base by the role the viewer has in the base (Req 19.6)', async () => {
      const shared = await kit.createPage('base-shared');
      const hidden = await hiddenPage('base-hidden');
      const page = await kit.createPage('base-rework');
      const base = await pendingProposal(
        [kit.editInput(shared), kit.editInput(hidden)],
        { reviewers: [userReviewer(users.subscriber)] },
      );
      const [sharedKey, hiddenKey] = base.operations.map((op) => op.key);
      const rework = await pendingProposal([kit.editInput(page)], {
        reviewers: [userReviewer(users.subscriber)],
        basedOn: {
          proposalId: base._id,
          relation: 'rework',
          operationKeys: [sharedKey, hiddenKey],
        },
      });

      const view = viewOf(
        await service.getForViewer(rework._id, users.subscriber),
      );

      expect(view.basedOn).toEqual({
        proposalId: base._id,
        relation: 'rework',
        operationKeys: [sharedKey],
      });
      expect(JSON.stringify(view)).not.toContain(hiddenKey);
    });

    it('leaves out the base when the viewer is neither its requester nor its reviewer and it has nothing applied', async () => {
      const shared = await kit.createPage('base-other');
      const page = await kit.createPage('base-other-rework');
      const base = await pendingProposal([kit.editInput(shared)], {
        reviewers: [userReviewer(users.other)],
      });
      const rework = await pendingProposal([kit.editInput(page)], {
        reviewers: [userReviewer(users.subscriber)],
        basedOn: {
          proposalId: base._id,
          relation: 'rework',
          operationKeys: [base.operations[0].key],
        },
      });

      const view = viewOf(
        await service.getForViewer(rework._id, users.subscriber),
      );

      expect(view).not.toHaveProperty('basedOn');
      expect(JSON.stringify(view)).not.toContain(base._id);
    });
  });

  it('answers a reviewer with no visible operation exactly as for a missing proposal, records or not (Req 19.4)', async () => {
    const hidden = await hiddenPage('none-hidden');
    const proposal = await pendingProposal([kit.editInput(hidden)], {
      reviewers: [userReviewer(users.subscriber)],
      purpose: PURPOSE,
    });
    await seedReviews(proposal._id, [
      {
        kind: 'reject',
        by: idOf(users.subscriber),
        at: at(1),
        comment: WHOLE_REJECT_COMMENT,
        channel: 'ui',
      },
    ]);

    expect(await service.getForViewer(proposal._id, users.subscriber)).toEqual(
      NOT_FOUND,
    );
  });
});
