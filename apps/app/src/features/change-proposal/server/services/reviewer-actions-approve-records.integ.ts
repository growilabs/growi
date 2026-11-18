import type { IUserHasId } from '@growi/core';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { beginActivity } from '~/server/service/activity/index';
import { prisma } from '~/utils/prisma';

import type { ChangeProposalDocument, ReviewerRef } from '../../interfaces';
import type {
  CreateOperationInput,
  ReviewEntry,
} from '../models/change-proposal-types';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import { createApplierTestKit } from './proposal-applier.test-kit';
import { findReviewNotifications } from './review-notifications.test-kit';
import type { ReviewActor } from './reviewer-actions';
import { loadViewerIdentity } from './reviewer-identity';

const TEST_IP = '10.0.0.163';
const TEST_ENDPOINT = '/_api/v3/cp-reviewer-approve-records-integ';
const PREFIX = '/cp-reviewer-approve-records-integ';
const BACKGROUND = { kind: 'background' } as const;

describe('ChangeProposalService.approve: the records an approval leaves', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpApproveRecordsRequester',
      subscriber: 'cpApproveRecordsReviewer',
      other: 'cpApproveRecordsOther',
    },
  });
  const { users } = kit;

  const actor = (user: IUserHasId): ReviewActor => ({
    user,
    channel: 'ui',
    trigger: BACKGROUND,
  });

  const pendingProposal = (operations: readonly CreateOperationInput[]) =>
    kit.storeProposal(operations, {
      approve: false,
      reviewers: [
        {
          kind: 'user',
          id: users.subscriber._id.toString(),
          addedBy: users.requester._id.toString(),
          addedAt: new Date(),
        } satisfies ReviewerRef,
      ],
    });

  const keysOf = (proposal: ChangeProposalDocument): string[] =>
    proposal.operations.map((op) => op.key);

  const reject = async (proposalId: string, target: ReviewEntry['target']) => {
    const entry: ReviewEntry =
      target.scope === 'whole'
        ? { kind: 'reject', target, channel: 'ui' }
        : { kind: 'reject', target, channel: 'ui' };
    return expect(
      await prisma.changeproposals.addReviews(
        proposalId,
        await loadViewerIdentity(users.subscriber._id.toString()),
        entry,
        new Date(),
      ),
    ).toEqual({ ok: true });
  };

  // [operationKey, kind] of the reviewer's remaining records; '' is the whole rejection.
  const reviewsLeft = async (proposalId: string) =>
    (await kit.reload(proposalId)).reviews
      .filter((r) => r.by === users.subscriber._id.toString())
      .map((r) => [r.operationKey ?? '', r.kind]);

  const waitForActivities = (proposalId: string, count: number) =>
    vi.waitFor(
      async () => {
        const rows = await prisma.activities.findMany({
          where: { target: proposalId },
        });
        if (rows.length < count) {
          throw new Error(`${rows.length} activities for ${proposalId}`);
        }
        return rows;
      },
      { timeout: 5000, interval: 50 },
    );

  // Restoring a spy on a Prisma extension method leaves the method undefined, so
  // the spy stays installed and calls the bound original unless a test overrides it.
  // Created in beforeAll: the Prisma client must not be touched before setup connects it.
  const spyOnMarkApproved = () => {
    const original = prisma.changeproposals.markApproved.bind(
      prisma.changeproposals,
    );
    return {
      original,
      spy: vi.spyOn(prisma.changeproposals, 'markApproved'),
    };
  };
  let markApproved: ReturnType<typeof spyOnMarkApproved>;
  let emitSpy: { mockRestore(): void } | undefined;

  const resultNotifications = (proposalId: string) =>
    findReviewNotifications('review-result', { target: proposalId });

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    service = createChangeProposalService(crowi, {
      applier: kit.newApplier(),
    });
    markApproved = spyOnMarkApproved();
  });

  beforeEach(() => {
    markApproved.spy.mockReset().mockImplementation(markApproved.original);
    // Page events have async listeners (search, vault) unrelated to this test.
    emitSpy = vi
      .spyOn(crowi.pageService.pageEvent, 'emit')
      .mockReturnValue(true);
  });

  afterEach(async () => {
    await kit.waitForPageOperationsToFinish();
    kit.editingPageIds.clear();
    emitSpy?.mockRestore();
  });

  afterAll(async () => {
    await kit.tearDown();
  });

  describe("the approver's own reject and abstain records", () => {
    it('drops the records of the approved operations but keeps the whole rejection on a keyed approval (Req 17.4)', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('keyed-a')),
        kit.editInput(await kit.createPage('keyed-b')),
      ]);
      const [first, second] = keysOf(proposal);
      await reject(proposal._id, {
        scope: 'operations',
        operationKeys: [first, second],
      });
      await reject(proposal._id, { scope: 'whole' });

      await service.approve(proposal._id, actor(users.subscriber), [first]);

      expect(await reviewsLeft(proposal._id)).toEqual(
        expect.arrayContaining([
          [second, 'reject'],
          ['', 'reject'],
        ]),
      );
      expect(await reviewsLeft(proposal._id)).toHaveLength(2);
    });

    it('drops the whole rejection too on a whole approval (Req 17.4)', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('whole')),
      ]);
      await reject(proposal._id, {
        scope: 'operations',
        operationKeys: keysOf(proposal),
      });
      await reject(proposal._id, { scope: 'whole' });

      await service.approve(proposal._id, actor(users.subscriber));

      expect(await reviewsLeft(proposal._id)).toEqual([]);
    });

    it('drops the record of an operation left pending because someone is editing its page (Req 17.4, 16.10)', async () => {
      const page = await kit.createPage('edited');
      const proposal = await pendingProposal([kit.editInput(page)]);
      await reject(proposal._id, {
        scope: 'operations',
        operationKeys: keysOf(proposal),
      });
      kit.editingPageIds.add(page._id.toString());

      await service.approve(proposal._id, actor(users.subscriber));

      expect((await kit.reload(proposal._id)).operations[0].status).toBe(
        'pending',
      );
      expect(await reviewsLeft(proposal._id)).toEqual([]);
    });
  });

  it('drops the record of an operation whose approval another request already wrote (Req 17.4)', async () => {
    const proposal = await pendingProposal([
      kit.editInput(await kit.createPage('approved-before')),
    ]);
    await reject(proposal._id, {
      scope: 'operations',
      operationKeys: keysOf(proposal),
    });
    // Approved by the requester and still waiting for its apply.
    await prisma.changeproposals.markApproved(
      proposal._id,
      proposal.requester,
      keysOf(proposal),
      new Date(),
    );

    await service.approve(proposal._id, actor(users.subscriber));

    expect(await reviewsLeft(proposal._id)).toEqual([]);
  });

  describe('an approval the write gave up on after write conflicts', () => {
    it('leaves the reject record, records nothing and answers the operation as still pending while the proposal is open (Req 17.4, 20.5, 20.8)', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('conflict-open')),
      ]);
      const [key] = keysOf(proposal);
      await reject(proposal._id, { scope: 'operations', operationKeys: [key] });
      markApproved.spy.mockResolvedValueOnce({ ok: false, code: 'not-open' });

      const result = await service.approve(
        proposal._id,
        actor(users.subscriber),
      );

      expect(result).toEqual({
        ok: true,
        value: { type: 'done', results: [{ key, status: 'pending' }] },
      });
      expect(await reviewsLeft(proposal._id)).toEqual([[key, 'reject']]);
      const [op] = (await kit.reload(proposal._id)).operations;
      expect([op.status, op.approvedAt]).toEqual(['pending', undefined]);
      await new Promise((resolve) => {
        setTimeout(resolve, 300);
      });
      expect(
        await prisma.activities.findMany({
          where: {
            target: proposal._id,
            action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPROVE,
          },
        }),
      ).toEqual([]);
      expect(await resultNotifications(proposal._id)).toEqual([]);
    });

    it('answers not-open when the proposal closed meanwhile (Req 16.9)', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('conflict-closed')),
      ]);
      markApproved.spy.mockImplementationOnce(async () => {
        await prisma.changeproposals.skipPendingOperations(
          proposal._id,
          proposal.requester,
          'all-pending',
          'discarded',
        );
        return { ok: false, code: 'not-open' };
      });

      expect(
        await service.approve(proposal._id, actor(users.subscriber)),
      ).toEqual({ ok: false, error: { code: 'not-open' } });
    });
  });

  describe('activities', () => {
    it("records the approval on the request's activity with its ip, and the apply as the requester on a new one without it (Req 20.8, 20.9)", async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('activity')),
      ]);
      const { activityId } = beginActivity({
        ip: TEST_IP,
        endpoint: TEST_ENDPOINT,
        userId: users.subscriber._id.toString(),
        username: users.subscriber.username,
        createdAt: new Date(),
      });

      const result = await service.approve(proposal._id, {
        user: users.subscriber,
        channel: 'api',
        trigger: { kind: 'request', activityId },
      });

      expect(result.ok).toBe(true);
      const rows = await waitForActivities(proposal._id, 2);
      const approval = rows.find((row) => row.id === activityId);
      const apply = rows.find((row) => row.id !== activityId);
      expect(approval).toMatchObject({
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPROVE,
        userId: users.subscriber._id.toString(),
        ip: TEST_IP,
        endpoint: TEST_ENDPOINT,
      });
      expect(approval?.snapshot).toMatchObject({ reviewChannel: 'api' });
      expect(apply).toMatchObject({
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
        userId: users.requester._id.toString(),
      });
      // Stored empty rather than absent when the activity had none.
      expect([apply?.ip || null, apply?.endpoint || null]).toEqual([
        null,
        null,
      ]);
      expect(rows).toHaveLength(2);
    });

    it('records no approval when the request approved nothing (Req 20.8)', async () => {
      const proposal = await pendingProposal([
        kit.editInput(await kit.createPage('nothing-a')),
        kit.editInput(await kit.createPage('nothing-b')),
      ]);
      const [applied] = keysOf(proposal);
      await service.approve(proposal._id, actor(users.requester), [applied]);
      const before = await waitForActivities(proposal._id, 2);

      await service.approve(proposal._id, actor(users.subscriber), [applied]);

      await new Promise((resolve) => {
        setTimeout(resolve, 300);
      });
      expect(
        await prisma.activities.findMany({ where: { target: proposal._id } }),
      ).toHaveLength(before.length);
    });
  });
});
