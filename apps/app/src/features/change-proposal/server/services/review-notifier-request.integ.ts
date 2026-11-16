import type { IUserHasId } from '@growi/core';
import { GroupType, PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument, PageModel } from '~/server/models/page';
import { UserStatus } from '~/server/models/user/conts';
import { prisma } from '~/utils/prisma';

import type {
  ChangeProposalDocument,
  ReviewerInput,
  ReviewRequestNotificationSnapshot,
} from '../../interfaces';
import type { CreateOperationInput } from '../models/change-proposal-types';
import { createReviewNotifier } from './review-notifier';

const PREFIX = '/cp-review-notifier-request-integ';
const SECRET_BODY = 'CP-REVIEW-REQUEST-SECRET-BODY';
const USERNAMES = {
  requester: 'cpReviewRequestRequester',
  adder: 'cpReviewRequestAdder',
  member: 'cpReviewRequestMember',
  outsider: 'cpReviewRequestOutsider',
  groupOnly: 'cpReviewRequestGroupOnly',
  suspended: 'cpReviewRequestSuspended',
} as const;
type UserKey = keyof typeof USERNAMES;

describe('ReviewNotifier.notifyReviewRequest', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let groupId: string;
  const users = {} as Record<UserKey, HydratedDocument<IUserHasId>>;
  const pages = {} as Record<
    'public' | 'group' | 'linkOnly' | 'groupParent',
    HydratedDocument<PageDocument>
  >;
  let seq = 0;

  const idOf = (doc: { _id: unknown }): string => String(doc._id);

  const createPage = (
    label: string,
    grant: PageGrant,
  ): Promise<HydratedDocument<PageDocument>> => {
    seq += 1;
    return Page.create({
      path: `${PREFIX}/${label}-${seq}`,
      grant,
      grantedGroups:
        grant === PageGrant.GRANT_USER_GROUP
          ? [{ item: groupId, type: GroupType.userGroup }]
          : [],
      isEmpty: false,
    });
  };

  const editInput = (page: HydratedDocument<PageDocument>) =>
    ({
      type: 'edit',
      pageId: idOf(page),
      baseRevisionId: new mongoose.Types.ObjectId().toString(),
      body: `${SECRET_BODY} for ${page.path}`,
    }) as const;

  const userReviewer = (key: UserKey): ReviewerInput => ({
    kind: 'user',
    id: idOf(users[key]),
  });

  const storeProposal = (
    reviewers: readonly ReviewerInput[],
    operations: readonly CreateOperationInput[],
  ): Promise<ChangeProposalDocument> =>
    prisma.changeproposals.createProposal({
      requester: idOf(users.requester),
      entry: 'ai-chat',
      perPageNotifications: false,
      operations,
      reviewers: reviewers.map((r) => ({
        ...r,
        addedBy: idOf(users.requester),
        addedAt: new Date(),
      })),
    });

  const notificationsFor = (proposalId: string) =>
    InAppNotification.find({ target: proposalId }).lean().exec();

  const recipientNames = (
    notifications: Awaited<ReturnType<typeof notificationsFor>>,
  ): string[] =>
    notifications
      .map(
        (n) =>
          Object.entries(users).find(
            ([, u]) => idOf(u) === n.user.toString(),
          )?.[0] ?? 'unknown',
      )
      .sort();

  const snapshotFor = (
    notifications: Awaited<ReturnType<typeof notificationsFor>>,
    key: UserKey,
  ): ReviewRequestNotificationSnapshot | undefined => {
    const found = notifications.find(
      (n) => n.user.toString() === idOf(users[key]),
    );
    return found == null ? undefined : JSON.parse(found.snapshot);
  };

  const byPath = (a: { path: string }, b: { path: string }) =>
    a.path.localeCompare(b.path);

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');

    const User = mongoose.model<IUserHasId>('User');
    for (const [key, username] of Object.entries(USERNAMES)) {
      // biome-ignore lint/performance/noAwaitInLoops: a handful of fixture users
      users[key as UserKey] = await User.create({
        name: username,
        username,
        email: `${username}@example.com`,
        status:
          key === 'suspended'
            ? UserStatus.STATUS_SUSPENDED
            : UserStatus.STATUS_ACTIVE,
      });
    }
    groupId = idOf(
      await mongoose
        .model('UserGroup')
        .create({ name: 'cpReviewRequestGroup' }),
    );
    await mongoose.model('UserGroupRelation').create(
      (['member', 'groupOnly', 'suspended'] as const).map((key) => ({
        relatedGroup: groupId,
        relatedUser: users[key]._id,
      })),
    );

    pages.public = await createPage('public', PageGrant.GRANT_PUBLIC);
    pages.group = await createPage('group', PageGrant.GRANT_USER_GROUP);
    pages.linkOnly = await createPage('link-only', PageGrant.GRANT_RESTRICTED);
    pages.groupParent = await createPage(
      'group-parent',
      PageGrant.GRANT_USER_GROUP,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    const userIds = Object.values(users).map((u) => u._id);
    await InAppNotification.deleteMany({ user: { $in: userIds } });
    await prisma.changeproposals.deleteMany({
      where: { requester: idOf(users.requester) },
    });
    await Page.deleteMany({ path: new RegExp(`^${PREFIX}(/|$)`) });
    await mongoose
      .model('UserGroupRelation')
      .deleteMany({ relatedGroup: groupId });
    await mongoose.model('UserGroup').deleteMany({ _id: groupId });
    await mongoose.model('User').deleteMany({ _id: { $in: userIds } });
  });

  describe('a proposal with user and group reviewers', () => {
    let proposal: ChangeProposalDocument;
    let activityId: string;
    let createdPath: string;

    beforeAll(async () => {
      createdPath = `${pages.groupParent.path}/new-child`;
      const reviewers = [
        userReviewer('member'),
        userReviewer('outsider'),
        userReviewer('adder'),
        userReviewer('requester'),
        userReviewer('suspended'),
        { kind: 'user-group', id: groupId } as const,
      ];
      proposal = await storeProposal(reviewers, [
        editInput(pages.public),
        editInput(pages.group),
        editInput(pages.linkOnly),
        { type: 'create', path: createdPath, body: SECRET_BODY },
      ]);
      activityId = new mongoose.Types.ObjectId().toString();

      await createReviewNotifier(crowi).notifyReviewRequest({
        proposal,
        candidates: reviewers,
        actorId: idOf(users.adder),
        activityId,
      });
    });

    it('notifies only the individual users who became reviewers, not the requester, the adder, group members or a suspended user (Reviewers Req 4.11, 6.1, 6.2)', async () => {
      const notifications = await notificationsFor(proposal._id);

      expect(recipientNames(notifications)).toEqual(['member', 'outsider']);
      for (const n of notifications) {
        expect(n).toMatchObject({
          targetModel: SupportedTargetModel.MODEL_CHANGE_PROPOSAL,
          action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEW_REQUEST,
          status: 'UNOPENED',
        });
        expect(n.target.toString()).toBe(proposal._id);
        expect(n.activities.map(String)).toEqual([activityId]);
      }
    });

    it('builds each notification from the pages its recipient may decide, a create by its path alone (Reviewers Req 6.3)', async () => {
      const notifications = await notificationsFor(proposal._id);

      const forMember = snapshotFor(notifications, 'member');
      expect(forMember).toEqual({
        kind: 'review-request',
        proposalId: proposal._id,
        requester: {
          id: idOf(users.requester),
          username: USERNAMES.requester,
        },
        pages: expect.any(Array),
      });
      expect([...(forMember?.pages ?? [])].sort(byPath)).toEqual(
        [
          { id: idOf(pages.public), path: pages.public.path },
          { id: idOf(pages.group), path: pages.group.path },
          { path: createdPath },
        ].sort(byPath),
      );
      expect(snapshotFor(notifications, 'outsider')?.pages).toEqual([
        { id: idOf(pages.public), path: pages.public.path },
      ]);
    });

    it('stores nothing about a page the recipient cannot view or may only view by link (Reviewers Req 4.11, 6.3)', async () => {
      const notifications = await notificationsFor(proposal._id);
      const forOutsider = notifications.find(
        (n) => n.user.toString() === idOf(users.outsider),
      );
      const raw = JSON.stringify(forOutsider);

      expect(raw).not.toContain(SECRET_BODY);
      for (const hidden of [pages.group, pages.linkOnly, pages.groupParent]) {
        expect(raw).not.toContain(hidden.path);
        expect(raw).not.toContain(idOf(hidden));
      }
      const rawForMember = JSON.stringify(
        notifications.find((n) => n.user.toString() === idOf(users.member)),
      );
      expect(rawForMember).not.toContain(pages.linkOnly.path);
      expect(rawForMember).not.toContain(idOf(pages.linkOnly));
    });
  });

  it('sends nothing to a reviewer with no operation to decide (Reviewers Req 6.4)', async () => {
    const reviewers = [userReviewer('outsider')];
    const proposal = await storeProposal(reviewers, [
      editInput(pages.group),
      editInput(pages.linkOnly),
    ]);

    await createReviewNotifier(crowi).notifyReviewRequest({
      proposal,
      candidates: reviewers,
      actorId: idOf(users.requester),
      activityId: new mongoose.Types.ObjectId().toString(),
    });

    expect(await notificationsFor(proposal._id)).toHaveLength(0);
  });

  it('sends nothing to a candidate who is no longer an active reviewer of the stored proposal', async () => {
    const proposal = await storeProposal(
      [userReviewer('member')],
      [editInput(pages.public)],
    );

    await createReviewNotifier(crowi).notifyReviewRequest({
      proposal,
      candidates: [userReviewer('outsider')],
      actorId: idOf(users.requester),
      activityId: new mongoose.Types.ObjectId().toString(),
    });

    expect(await notificationsFor(proposal._id)).toHaveLength(0);
  });

  it('announces the notification over Socket.IO to the recipients only', async () => {
    const emitSocketIo = vi
      .spyOn(crowi.inAppNotificationService, 'emitSocketIo')
      .mockResolvedValue(undefined);
    const reviewers = [userReviewer('member'), userReviewer('outsider')];
    const proposal = await storeProposal(reviewers, [editInput(pages.group)]);

    await createReviewNotifier(crowi).notifyReviewRequest({
      proposal,
      candidates: reviewers,
      actorId: idOf(users.requester),
      activityId: new mongoose.Types.ObjectId().toString(),
    });

    expect(emitSocketIo).toHaveBeenCalledTimes(1);
    expect(emitSocketIo).toHaveBeenCalledWith([idOf(users.member)]);
  });

  it('only logs when creating the notifications fails', async () => {
    const reviewers = [userReviewer('outsider')];
    const proposal = await storeProposal(reviewers, [editInput(pages.public)]);
    vi.spyOn(InAppNotification, 'insertMany').mockRejectedValueOnce(
      new Error('insert failed'),
    );

    await expect(
      createReviewNotifier(crowi).notifyReviewRequest({
        proposal,
        candidates: reviewers,
        actorId: idOf(users.requester),
        activityId: new mongoose.Types.ObjectId().toString(),
      }),
    ).resolves.toBeUndefined();
  });
});
