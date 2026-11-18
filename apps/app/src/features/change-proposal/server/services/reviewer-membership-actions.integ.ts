import type { IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { Prisma } from '~/generated/prisma/client';
import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import { UserStatus } from '~/server/models/user/conts';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import {
  type ChangeProposalDocument,
  MAX_REVIEWERS,
  type ReviewerInput,
  type ReviewerRef,
} from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import { createApplierTestKit } from './proposal-applier.test-kit';
import type { ReviewActor } from './reviewer-actions';
import { loadViewerIdentity } from './reviewer-identity';

const PREFIX = '/cp-reviewer-membership-integ';
const GROUP_NAME = 'cpMembershipGroup';
const BACKGROUND = { kind: 'background' } as const;
const NOW = new Date('2026-11-17T09:00:00.000Z');
const NOT_FOUND = { ok: false, error: { code: 'not-found' } };
const DONE = { ok: true, value: undefined };

describe('ChangeProposalService: adding and removing reviewers', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  let groupId: string;
  let extra: {
    readonly added: HydratedDocument<IUserHasId>;
    readonly member: HydratedDocument<IUserHasId>;
    readonly suspended: HydratedDocument<IUserHasId>;
  };
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: '10.0.0.164',
    usernames: {
      requester: 'cpMembershipRequester',
      subscriber: 'cpMembershipReviewer',
      other: 'cpMembershipStranger',
    },
  });
  const { users } = kit;

  const actor = (user: IUserHasId): ReviewActor => ({
    user,
    channel: 'ui',
    trigger: BACKGROUND,
  });

  const idOf = (user: IUserHasId): string => user._id.toString();

  const userInput = (user: IUserHasId): ReviewerInput => ({
    kind: 'user',
    id: idOf(user),
  });

  const groupInput = (): ReviewerInput => ({ kind: 'user-group', id: groupId });

  const storedRef = (
    input: ReviewerInput,
    addedBy: IUserHasId = users.requester,
  ): ReviewerRef => ({ ...input, addedBy: idOf(addedBy), addedAt: NOW });

  const pendingProposal = async (
    reviewers: readonly ReviewerRef[] = [
      storedRef(userInput(users.subscriber)),
    ],
    operations?: readonly CreateOperationInput[],
  ) =>
    kit.storeProposal(
      operations ?? [kit.editInput(await kit.createPage('page'))],
      { approve: false, reviewers },
    );

  // Viewable by the requester alone, so hidden from every reviewer.
  const requesterOnlyPage = async (label: string) => {
    const page = await crowi.pageService.create(
      kit.nextPath(label),
      'base body',
      users.requester,
      { grant: PageGrant.GRANT_OWNER },
    );
    await kit.waitForPageOperationsToFinish();
    return kit.findPage(page._id);
  };

  const reviewersOf = async (
    proposal: ChangeProposalDocument,
  ): Promise<readonly ReviewerRef[]> =>
    (await kit.reload(proposal._id)).reviewers;

  const activeIdsOf = async (proposal: ChangeProposalDocument) =>
    (await reviewersOf(proposal))
      .filter((r) => r.removedAt == null)
      .map((r) => `${r.kind}:${r.id}`)
      .sort();

  // Who received a review request for the proposal, by user id.
  const requestedUserIds = async (proposalId: string) =>
    (
      await InAppNotification.find({
        target: proposalId,
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEW_REQUEST,
      })
        .lean()
        .exec()
    )
      .map((n) => n.user.toString())
      .sort();

  const activitiesOf = (proposalId: string) =>
    prisma.activities.findMany({ where: { target: proposalId } });

  // Activities settle asynchronously: wait for the expected count, then for any stray one.
  const settledActivitiesOf = async (proposalId: string, count: number) => {
    await vi.waitFor(
      async () => {
        const rows = await activitiesOf(proposalId);
        if (rows.length < count) {
          throw new Error(`${rows.length} activities for ${proposalId}`);
        }
      },
      { timeout: 5000, interval: 50 },
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
    return activitiesOf(proposalId);
  };

  const noActivityAfterAWhile = async (proposalId: string) => {
    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
    expect(await activitiesOf(proposalId)).toEqual([]);
  };

  const setReviewersEnabled = (enabled: boolean) =>
    configManager.updateConfigs({
      'app:changeProposalReviewersEnabled': enabled,
    });

  // Restoring a spy on a Prisma model method leaves the method undefined, so
  // the spy stays installed and calls the bound original unless a test overrides it.
  // Created in beforeAll: the Prisma client must not be touched before setup connects it.
  const spyOnUpdateMany = () => {
    const original = prisma.changeproposals.updateMany.bind(
      prisma.changeproposals,
    );
    return {
      original,
      spy: vi.spyOn(prisma.changeproposals, 'updateMany'),
    };
  };
  const spyOnAddReviewers = () => {
    const original = prisma.changeproposals.addReviewers.bind(
      prisma.changeproposals,
    );
    return {
      original,
      spy: vi.spyOn(prisma.changeproposals, 'addReviewers'),
    };
  };
  let updateMany: ReturnType<typeof spyOnUpdateMany>;
  let addReviewers: ReturnType<typeof spyOnAddReviewers>;
  let emitSpy: { mockRestore(): void } | undefined;

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    const createUser = (
      username: string,
      status: UserStatus = UserStatus.STATUS_ACTIVE,
    ) =>
      mongoose.model<IUserHasId>('User').create({
        name: username,
        username,
        email: `${username}@example.com`,
        status,
      });
    extra = {
      added: await createUser('cpMembershipAdded'),
      member: await createUser('cpMembershipMember'),
      suspended: await createUser(
        'cpMembershipSuspended',
        UserStatus.STATUS_SUSPENDED,
      ),
    };
    groupId = (await UserGroup.create({ name: GROUP_NAME }))._id.toString();
    await UserGroupRelation.create({
      relatedGroup: groupId,
      relatedUser: extra.member._id,
    });
    service = createChangeProposalService(crowi, {
      applier: kit.newApplier(),
      now: () => NOW,
    });
    updateMany = spyOnUpdateMany();
    addReviewers = spyOnAddReviewers();
  });

  beforeEach(async () => {
    updateMany.spy.mockReset().mockImplementation(updateMany.original);
    addReviewers.spy.mockReset().mockImplementation(addReviewers.original);
    // Page events have async listeners (search, vault) unrelated to this test.
    emitSpy = vi
      .spyOn(crowi.pageService.pageEvent, 'emit')
      .mockReturnValue(true);
    await setReviewersEnabled(true);
  });

  afterEach(async () => {
    await kit.waitForPageOperationsToFinish();
    emitSpy?.mockRestore();
    await configManager.updateConfigs(
      { 'app:changeProposalReviewersEnabled': undefined },
      { removeIfUndefined: true },
    );
  });

  afterAll(async () => {
    const extraIds = Object.values(extra).map((u) => u._id);
    await InAppNotification.deleteMany({ user: { $in: extraIds } });
    await UserGroupRelation.deleteMany({ relatedGroup: groupId });
    await UserGroup.deleteMany({ _id: groupId });
    await mongoose.model('User').deleteMany({ _id: { $in: extraIds } });
    await kit.tearDown();
  });

  describe('an addition', () => {
    it('stores users and groups together once each, with who added them and when (Reviewers Req 4.1, 4.2, 4.10)', async () => {
      const proposal = await pendingProposal();

      const result = await service.addReviewers(
        proposal._id,
        actor(users.subscriber),
        [userInput(extra.added), groupInput(), userInput(extra.added)],
      );

      expect(result).toEqual(DONE);
      expect(await reviewersOf(proposal)).toEqual([
        storedRef(userInput(users.subscriber)),
        storedRef(userInput(extra.added), users.subscriber),
        storedRef(groupInput(), users.subscriber),
      ]);
    });

    it('notifies only the users it made reviewers: not one who already was, not a group’s members (Reviewers Req 4.11, 6.1, 6.2)', async () => {
      const proposal = await pendingProposal();

      await service.addReviewers(proposal._id, actor(users.requester), [
        userInput(users.subscriber),
        userInput(extra.added),
        groupInput(),
      ]);

      expect(await requestedUserIds(proposal._id)).toEqual([idOf(extra.added)]);
    });

    it('does not notify the one who added, even when they add themselves (Reviewers Req 4.11, 6.1)', async () => {
      const proposal = await pendingProposal([storedRef(groupInput())]);

      const result = await service.addReviewers(
        proposal._id,
        actor(extra.member),
        [userInput(extra.member), userInput(extra.added)],
      );

      expect(result).toEqual(DONE);
      expect(await activeIdsOf(proposal)).toEqual(
        [
          `user:${idOf(extra.member)}`,
          `user:${idOf(extra.added)}`,
          `user-group:${groupId}`,
        ].sort(),
      );
      expect(await requestedUserIds(proposal._id)).toEqual([idOf(extra.added)]);
    });

    it('records one reviewer-add activity, as the one who added, with the channel (Reviewers Req 6.10)', async () => {
      const proposal = await pendingProposal();

      await service.addReviewers(
        proposal._id,
        { ...actor(users.subscriber), channel: 'api' },
        [userInput(extra.added), groupInput()],
      );

      const rows = await settledActivitiesOf(proposal._id, 1);
      expect(
        rows.map((row) => [
          row.action,
          row.userId,
          row.snapshot?.reviewChannel,
        ]),
      ).toEqual([
        [
          SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEWER_ADD,
          idOf(users.subscriber),
          'api',
        ],
      ]);
    });

    it('changes nothing and sends and logs nothing when everyone it names already is a reviewer (Reviewers Req 4.6)', async () => {
      const proposal = await pendingProposal();
      const before = await reviewersOf(proposal);

      const result = await service.addReviewers(
        proposal._id,
        actor(users.requester),
        [userInput(users.subscriber), userInput(users.subscriber)],
      );

      expect(result).toEqual(DONE);
      expect(await reviewersOf(proposal)).toEqual(before);
      expect(await requestedUserIds(proposal._id)).toEqual([]);
      await noActivityAfterAWhile(proposal._id);
    });

    it('sends and logs nothing when another request made the same user a reviewer just before its write (Reviewers Req 4.6)', async () => {
      const proposal = await pendingProposal();
      const requester = await loadViewerIdentity(idOf(users.requester));
      addReviewers.spy.mockImplementationOnce(async (...args) => {
        await addReviewers.original(
          proposal._id,
          requester,
          [userInput(extra.added)],
          NOW,
        );
        return addReviewers.original(...args);
      });

      const result = await service.addReviewers(
        proposal._id,
        actor(users.subscriber),
        [userInput(extra.added)],
      );

      expect(result).toEqual(DONE);
      expect(
        (await reviewersOf(proposal)).filter((r) => r.id === idOf(extra.added)),
      ).toEqual([storedRef(userInput(extra.added))]);
      expect(await requestedUserIds(proposal._id)).toEqual([]);
      await noActivityAfterAWhile(proposal._id);
    });

    it('refuses a user or group that does not exist and adds none of the request (Reviewers Req 4.5)', async () => {
      const proposal = await pendingProposal();
      const before = await reviewersOf(proposal);
      const missingId = new mongoose.Types.ObjectId().toString();

      for (const missing of [
        { kind: 'user', id: missingId },
        { kind: 'user-group', id: missingId },
        { kind: 'external-user-group', id: missingId },
        { kind: 'user', id: 'not-an-object-id' },
      ] satisfies ReviewerInput[]) {
        expect(
          // biome-ignore lint/performance/noAwaitInLoops: each case must leave the proposal as it was
          await service.addReviewers(proposal._id, actor(users.requester), [
            userInput(extra.added),
            missing,
          ]),
        ).toEqual({ ok: false, error: { code: 'reviewer-not-found' } });
      }
      expect(await reviewersOf(proposal)).toEqual(before);
      expect(await requestedUserIds(proposal._id)).toEqual([]);
    });

    describe('the limit on reviewers', () => {
      const strangerRefs = (count: number): ReviewerRef[] =>
        Array.from({ length: count }, () =>
          storedRef({
            kind: 'user',
            id: new mongoose.Types.ObjectId().toString(),
          }),
        );

      it('counts the reviewers already there, and refuses going over it (Reviewers Req 4.9)', async () => {
        const proposal = await pendingProposal([
          storedRef(userInput(users.subscriber)),
          ...strangerRefs(MAX_REVIEWERS - 2),
        ]);
        const before = await reviewersOf(proposal);

        const result = await service.addReviewers(
          proposal._id,
          actor(users.requester),
          [userInput(extra.added), userInput(extra.member)],
        );

        expect(result).toEqual({
          ok: false,
          error: { code: 'too-many-reviewers' },
        });
        expect(await reviewersOf(proposal)).toEqual(before);
      });

      it('counts neither removed reviewers, nor a name given twice, nor one already a reviewer (Reviewers Req 4.6, 4.9)', async () => {
        const removed: ReviewerRef = {
          ...storedRef(userInput(extra.member)),
          removedBy: idOf(users.requester),
          removedAt: NOW,
        };
        const proposal = await pendingProposal([
          storedRef(userInput(users.subscriber)),
          ...strangerRefs(MAX_REVIEWERS - 2),
          removed,
        ]);

        expect(
          await service.addReviewers(proposal._id, actor(users.requester), [
            userInput(extra.added),
            userInput(extra.added),
            userInput(users.subscriber),
          ]),
        ).toEqual(DONE);
        expect(
          (await reviewersOf(proposal)).filter((r) => r.removedAt == null),
        ).toHaveLength(MAX_REVIEWERS);
      });
    });

    describe('while reviewers are switched off', () => {
      beforeEach(() => setReviewersEnabled(false));

      it('refuses a user or group other than the requester (design.md, 要件との差と読み方 3)', async () => {
        const proposal = await pendingProposal();
        const before = await reviewersOf(proposal);

        for (const input of [userInput(extra.added), groupInput()]) {
          expect(
            // biome-ignore lint/performance/noAwaitInLoops: each case must leave the proposal as it was
            await service.addReviewers(proposal._id, actor(users.requester), [
              input,
            ]),
          ).toEqual({ ok: false, error: { code: 'reviewers-disabled' } });
        }
        expect(await reviewersOf(proposal)).toEqual(before);
      });

      it('still lets the requester be added (design.md, 要件との差と読み方 3)', async () => {
        const proposal = await pendingProposal();

        expect(
          await service.addReviewers(proposal._id, actor(users.requester), [
            userInput(users.requester),
          ]),
        ).toEqual(DONE);
        expect(await activeIdsOf(proposal)).toContain(
          `user:${idOf(users.requester)}`,
        );
      });

      it('still answers naming only someone already a reviewer as done, changing, sending and logging nothing (Reviewers Req 4.6)', async () => {
        const proposal = await pendingProposal();
        const before = await reviewersOf(proposal);

        expect(
          await service.addReviewers(proposal._id, actor(users.requester), [
            userInput(users.subscriber),
          ]),
        ).toEqual(DONE);
        expect(await reviewersOf(proposal)).toEqual(before);
        expect(await requestedUserIds(proposal._id)).toEqual([]);
        await noActivityAfterAWhile(proposal._id);
      });
    });

    describe('a write that gives up partway', () => {
      // What the query engine raises once it gave up retrying on write conflicts.
      const writeConflict = () =>
        new Prisma.PrismaClientKnownRequestError('Transaction failed', {
          code: 'P2034',
          clientVersion: 'test',
        });

      it('fails the request, and sends and logs nothing for a reviewer stored before it gave up', async () => {
        const proposal = await pendingProposal();
        updateMany.spy
          .mockImplementationOnce(updateMany.original)
          .mockRejectedValueOnce(writeConflict());

        await expect(
          service.addReviewers(proposal._id, actor(users.requester), [
            userInput(extra.added),
            userInput(extra.member),
          ]),
        ).rejects.toThrow('write conflicts');

        expect(await activeIdsOf(proposal)).toEqual(
          [
            `user:${idOf(users.subscriber)}`,
            `user:${idOf(extra.added)}`,
          ].sort(),
        );
        expect(await requestedUserIds(proposal._id)).toEqual([]);
        await noActivityAfterAWhile(proposal._id);
      });
    });

    it('keeps both of two additions by different people at the same time (Reviewers Req 4.1)', async () => {
      const proposal = await pendingProposal();

      const results = await Promise.all([
        service.addReviewers(proposal._id, actor(users.subscriber), [
          userInput(extra.added),
        ]),
        service.addReviewers(proposal._id, actor(users.requester), [
          userInput(extra.member),
        ]),
      ]);

      expect(results).toEqual([DONE, DONE]);
      expect(await activeIdsOf(proposal)).toEqual(
        [
          `user:${idOf(users.subscriber)}`,
          `user:${idOf(extra.added)}`,
          `user:${idOf(extra.member)}`,
        ].sort(),
      );
    });
  });

  describe('a removal', () => {
    it('marks who removed whom and when, keeps the entries, and keeps their review records (Reviewers Req 4.3, 4.10, 4.12)', async () => {
      const proposal = await pendingProposal([
        storedRef(userInput(users.subscriber)),
        storedRef(userInput(extra.added)),
      ]);
      await prisma.changeproposals.addReviews(
        proposal._id,
        await loadViewerIdentity(idOf(users.subscriber)),
        { kind: 'reject', target: { scope: 'whole' }, channel: 'ui' },
        NOW,
      );

      const result = await service.removeReviewers(
        proposal._id,
        actor(users.subscriber),
        [userInput(users.subscriber), userInput(extra.added)],
      );

      expect(result).toEqual(DONE);
      const removal = { removedBy: idOf(users.subscriber), removedAt: NOW };
      expect(await reviewersOf(proposal)).toEqual([
        { ...storedRef(userInput(users.subscriber)), ...removal },
        { ...storedRef(userInput(extra.added)), ...removal },
      ]);
      expect(
        (await kit.reload(proposal._id)).reviews.map((r) => [r.by, r.kind]),
      ).toEqual([[idOf(users.subscriber), 'reject']]);
    });

    it('leaves the requester as the only reviewer once none is left (Reviewers Req 4.4)', async () => {
      const proposal = await pendingProposal();
      const [key] = proposal.operations.map((op) => op.key);

      expect(
        await service.removeReviewers(proposal._id, actor(users.requester), [
          userInput(users.subscriber),
        ]),
      ).toEqual(DONE);

      expect(
        await service.getForViewer(proposal._id, users.subscriber),
      ).toEqual(NOT_FOUND);
      expect(
        await service.approve(proposal._id, actor(users.subscriber)),
      ).toEqual(NOT_FOUND);
      expect(
        await service.approve(proposal._id, actor(users.requester)),
      ).toEqual({
        ok: true,
        value: {
          type: 'done',
          results: [expect.objectContaining({ key, status: 'applied' })],
        },
      });
    });

    it('records one reviewer-remove activity, as the one who removed, with the channel (Reviewers Req 6.10)', async () => {
      const proposal = await pendingProposal();

      await service.removeReviewers(
        proposal._id,
        { ...actor(users.requester), channel: 'ai-tool' },
        [userInput(users.subscriber)],
      );

      const rows = await settledActivitiesOf(proposal._id, 1);
      expect(
        rows.map((row) => [
          row.action,
          row.userId,
          row.snapshot?.reviewChannel,
        ]),
      ).toEqual([
        [
          SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEWER_REMOVE,
          idOf(users.requester),
          'ai-tool',
        ],
      ]);
    });

    it('changes and logs nothing for a name that is not a reviewer (Reviewers Req 4.7)', async () => {
      const proposal = await pendingProposal([
        storedRef(userInput(users.subscriber)),
        {
          ...storedRef(userInput(extra.member)),
          removedBy: idOf(users.requester),
          removedAt: NOW,
        },
      ]);
      const before = await reviewersOf(proposal);

      const result = await service.removeReviewers(
        proposal._id,
        actor(users.requester),
        [userInput(extra.added), userInput(extra.member), groupInput()],
      );

      expect(result).toEqual(DONE);
      expect(await reviewersOf(proposal)).toEqual(before);
      await noActivityAfterAWhile(proposal._id);
    });

    it('still works while reviewers are switched off (design.md, 要件との差と読み方 3)', async () => {
      await setReviewersEnabled(false);
      const proposal = await pendingProposal();

      expect(
        await service.removeReviewers(proposal._id, actor(users.requester), [
          userInput(users.subscriber),
        ]),
      ).toEqual(DONE);
      expect(await activeIdsOf(proposal)).toEqual([]);
    });
  });

  describe('who may not change the reviewers', () => {
    it('refuses both on a proposal that is no longer open, the requester included (Reviewers Req 4.8)', async () => {
      const proposal = await pendingProposal();
      await prisma.changeproposals.skipPendingOperations(
        proposal._id,
        proposal.requester,
        'all-pending',
        'discarded',
      );
      const before = await reviewersOf(proposal);
      const notOpen = { ok: false, error: { code: 'not-open' } };

      for (const who of [users.requester, users.subscriber]) {
        expect(
          // biome-ignore lint/performance/noAwaitInLoops: each case must leave the proposal as it was
          await service.addReviewers(proposal._id, actor(who), [
            userInput(extra.added),
          ]),
        ).toEqual(notOpen);
        expect(
          await service.removeReviewers(proposal._id, actor(who), [
            userInput(users.subscriber),
          ]),
        ).toEqual(notOpen);
      }
      expect(await reviewersOf(proposal)).toEqual(before);
    });

    it('answers a stranger, a reviewer who sees no operation and a missing proposal alike (Reviewers Req 2.7)', async () => {
      const proposal = await pendingProposal(undefined, [
        kit.editInput(await requesterOnlyPage('hidden')),
      ]);
      const before = await reviewersOf(proposal);
      const missingId = new mongoose.Types.ObjectId().toString();

      for (const [proposalId, who] of [
        [proposal._id, users.subscriber],
        [proposal._id, users.other],
        [missingId, users.subscriber],
      ] as const) {
        expect(
          // biome-ignore lint/performance/noAwaitInLoops: each case must leave the proposal as it was
          await service.addReviewers(proposalId, actor(who), [
            userInput(extra.added),
          ]),
        ).toEqual(NOT_FOUND);
        expect(
          await service.removeReviewers(proposalId, actor(who), [
            userInput(users.subscriber),
          ]),
        ).toEqual(NOT_FOUND);
      }
      expect(await reviewersOf(proposal)).toEqual(before);
      expect(await requestedUserIds(proposal._id)).toEqual([]);
    });

    it('refuses a user whose account is not active', async () => {
      const proposal = await pendingProposal([
        storedRef(userInput(extra.suspended)),
      ]);
      const before = await reviewersOf(proposal);
      const notAllowed = { ok: false, error: { code: 'user-not-allowed' } };

      expect(
        await service.addReviewers(proposal._id, actor(extra.suspended), [
          userInput(extra.added),
        ]),
      ).toEqual(notAllowed);
      expect(
        await service.removeReviewers(proposal._id, actor(extra.suspended), [
          userInput(extra.suspended),
        ]),
      ).toEqual(notAllowed);
      expect(await reviewersOf(proposal)).toEqual(before);
    });

    it('refuses an empty or malformed list as an invalid request', async () => {
      const proposal = await pendingProposal();
      const before = await reviewersOf(proposal);
      const invalid = { ok: false, error: { code: 'invalid-request' } };
      // What an AI tool could pass, as the service is called without the route's validators.
      const malformed: readonly ReviewerInput[][] = JSON.parse(
        JSON.stringify([
          [],
          [{ kind: 'role', id: idOf(extra.added) }],
          [{ kind: 'user', id: 1 }],
          [null],
        ]),
      );

      for (const inputs of malformed) {
        expect(
          // biome-ignore lint/performance/noAwaitInLoops: each case must leave the proposal as it was
          await service.addReviewers(
            proposal._id,
            actor(users.requester),
            inputs,
          ),
        ).toEqual(invalid);
        expect(
          await service.removeReviewers(
            proposal._id,
            actor(users.requester),
            inputs,
          ),
        ).toEqual(invalid);
      }
      expect(await reviewersOf(proposal)).toEqual(before);
    });
  });
});
