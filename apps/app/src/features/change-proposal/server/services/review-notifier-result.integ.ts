import type { IUserHasId } from '@growi/core';
import { GroupType, PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument, PageModel } from '~/server/models/page';
import { prisma } from '~/utils/prisma';

import type {
  ChangeProposalDocument,
  ReviewResultNotificationSnapshot,
} from '../../interfaces';
import { createReviewNotifier } from './review-notifier';

const PREFIX = '/cp-review-notifier-result-integ';
const USERNAMES = {
  requester: 'cpReviewResultRequester',
  reviewer: 'cpReviewResultReviewer',
} as const;

describe('ReviewNotifier.notifyReviewResult', () => {
  let crowi: Crowi;
  let Page: PageModel;
  let groupId: string;
  const users = {} as Record<
    keyof typeof USERNAMES,
    HydratedDocument<IUserHasId>
  >;
  // The group page is one the reviewer views and the requester does not.
  const pages = {} as Record<
    'public' | 'group',
    HydratedDocument<PageDocument>
  >;
  let createdPath: string;

  const idOf = (doc: { _id: unknown }): string => String(doc._id);

  const editInput = (page: HydratedDocument<PageDocument>) =>
    ({
      type: 'edit',
      pageId: idOf(page),
      baseRevisionId: new mongoose.Types.ObjectId().toString(),
      body: 'proposed body',
    }) as const;

  // Operation keys in order: the public edit, the group edit, the create.
  const storeProposal = (): Promise<ChangeProposalDocument> =>
    prisma.changeproposals.createProposal({
      requester: idOf(users.requester),
      entry: 'ai-chat',
      perPageNotifications: false,
      operations: [
        editInput(pages.public),
        editInput(pages.group),
        { type: 'create', path: createdPath, body: 'body' },
      ],
      reviewers: [
        {
          kind: 'user',
          id: idOf(users.reviewer),
          addedBy: idOf(users.requester),
          addedAt: new Date(),
        },
      ],
    });

  const keysOf = (proposal: ChangeProposalDocument) => {
    const [publicEdit, groupEdit, create] = proposal.operations.map(
      (op) => op.key,
    );
    return { publicEdit, groupEdit, create };
  };

  const notificationsFor = (proposalId: string) =>
    InAppNotification.find({ target: proposalId }).lean().exec();

  const onlySnapshot = async (
    proposalId: string,
  ): Promise<ReviewResultNotificationSnapshot> => {
    const notifications = await notificationsFor(proposalId);
    expect(notifications).toHaveLength(1);
    return JSON.parse(notifications[0].snapshot);
  };

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');

    const User = mongoose.model<IUserHasId>('User');
    for (const [key, username] of Object.entries(USERNAMES)) {
      // biome-ignore lint/performance/noAwaitInLoops: two fixture users
      users[key as keyof typeof USERNAMES] = await User.create({
        name: username,
        username,
        email: `${username}@example.com`,
      });
    }
    groupId = idOf(
      await mongoose.model('UserGroup').create({ name: 'cpReviewResultGroup' }),
    );
    await mongoose
      .model('UserGroupRelation')
      .create({ relatedGroup: groupId, relatedUser: users.reviewer._id });

    pages.public = await Page.create({
      path: `${PREFIX}/public`,
      grant: PageGrant.GRANT_PUBLIC,
      isEmpty: false,
    });
    pages.group = await Page.create({
      path: `${PREFIX}/group-only-for-reviewer`,
      grant: PageGrant.GRANT_USER_GROUP,
      grantedGroups: [{ item: groupId, type: GroupType.userGroup }],
      isEmpty: false,
    });
    createdPath = `${pages.public.path}/new-child`;
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

  it('sends the requester one notification per request, with the activity of that request (Reviewers Req 6.5)', async () => {
    const proposal = await storeProposal();
    const { publicEdit, create } = keysOf(proposal);
    const activityId = new mongoose.Types.ObjectId().toString();

    await createReviewNotifier(crowi).notifyReviewResult({
      proposal,
      reviewer: users.reviewer,
      activityId,
      decision: {
        kind: 'operations',
        result: 'approved',
        operationKeys: [publicEdit, create],
      },
    });

    const notifications = await notificationsFor(proposal._id);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      targetModel: SupportedTargetModel.MODEL_CHANGE_PROPOSAL,
      action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEW_RESULT,
      status: 'UNOPENED',
    });
    expect(notifications[0].user.toString()).toBe(idOf(users.requester));
    expect(notifications[0].target.toString()).toBe(proposal._id);
    expect(notifications[0].activities.map(String)).toEqual([activityId]);
    expect(JSON.parse(notifications[0].snapshot)).toEqual({
      kind: 'review-result',
      proposalId: proposal._id,
      reviewer: { id: idOf(users.reviewer), username: USERNAMES.reviewer },
      items: [
        { path: pages.public.path, result: 'approved' },
        { path: createdPath, result: 'approved' },
      ],
    });
  });

  it('leaves out an operation on a page the requester cannot view, and stores nothing about it (Reviewers Req 6.5)', async () => {
    const proposal = await storeProposal();
    const { publicEdit, groupEdit } = keysOf(proposal);

    await createReviewNotifier(crowi).notifyReviewResult({
      proposal,
      reviewer: users.reviewer,
      activityId: new mongoose.Types.ObjectId().toString(),
      decision: {
        kind: 'operations',
        result: 'rejected',
        operationKeys: [publicEdit, groupEdit],
        comment: 'needs work',
      },
    });

    const snapshot = await onlySnapshot(proposal._id);
    expect(snapshot.items).toEqual([
      { path: pages.public.path, result: 'rejected', comment: 'needs work' },
    ]);
    const raw = JSON.stringify(await notificationsFor(proposal._id));
    expect(raw).not.toContain(pages.group.path);
    expect(raw).not.toContain(idOf(pages.group));
  });

  it('sends nothing when every decided operation is on a page the requester cannot view (Reviewers Req 6.5)', async () => {
    const proposal = await storeProposal();

    await createReviewNotifier(crowi).notifyReviewResult({
      proposal,
      reviewer: users.reviewer,
      activityId: new mongoose.Types.ObjectId().toString(),
      decision: {
        kind: 'operations',
        result: 'abstained',
        operationKeys: [keysOf(proposal).groupEdit],
        comment: 'cannot judge',
      },
    });

    expect(await notificationsFor(proposal._id)).toHaveLength(0);
  });

  it('carries an abstention with its comment (Reviewers Req 6.5)', async () => {
    const proposal = await storeProposal();

    await createReviewNotifier(crowi).notifyReviewResult({
      proposal,
      reviewer: users.reviewer,
      activityId: new mongoose.Types.ObjectId().toString(),
      decision: {
        kind: 'operations',
        result: 'abstained',
        operationKeys: [keysOf(proposal).create],
        comment: 'cannot judge',
      },
    });

    expect((await onlySnapshot(proposal._id)).items).toEqual([
      { path: createdPath, result: 'abstained', comment: 'cannot judge' },
    ]);
  });

  it('leaves out an approved create whose created page the requester cannot view (Reviewers Req 6.5)', async () => {
    const stored = await storeProposal();
    const { create } = keysOf(stored);
    // As the applier hands the proposal back after applying the create.
    const proposal: ChangeProposalDocument = {
      ...stored,
      operations: stored.operations.map((op) =>
        op.key === create
          ? { ...op, status: 'applied', resultPageId: idOf(pages.group) }
          : op,
      ),
    };

    await createReviewNotifier(crowi).notifyReviewResult({
      proposal,
      reviewer: users.reviewer,
      activityId: new mongoose.Types.ObjectId().toString(),
      decision: {
        kind: 'operations',
        result: 'approved',
        operationKeys: [create],
      },
    });

    expect(await notificationsFor(proposal._id)).toHaveLength(0);
  });

  it('sends a whole-proposal rejection even with no operation in it (Reviewers Req 6.5)', async () => {
    const proposal = await storeProposal();

    await createReviewNotifier(crowi).notifyReviewResult({
      proposal,
      reviewer: users.reviewer,
      activityId: new mongoose.Types.ObjectId().toString(),
      decision: { kind: 'whole-rejection', comment: 'not this way' },
    });

    const snapshot = await onlySnapshot(proposal._id);
    expect(snapshot.items).toEqual([]);
    expect(snapshot.wholeRejection).toEqual({ comment: 'not this way' });
  });

  it('sends nothing for an approval by the requester (Reviewers Req 6.6)', async () => {
    const proposal = await storeProposal();

    await createReviewNotifier(crowi).notifyReviewResult({
      proposal,
      reviewer: users.requester,
      activityId: new mongoose.Types.ObjectId().toString(),
      decision: {
        kind: 'operations',
        result: 'approved',
        operationKeys: [keysOf(proposal).publicEdit],
      },
    });

    expect(await notificationsFor(proposal._id)).toHaveLength(0);
  });

  it('only logs when creating the notification fails', async () => {
    const proposal = await storeProposal();
    vi.spyOn(InAppNotification, 'create').mockRejectedValueOnce(
      new Error('create failed'),
    );

    await expect(
      createReviewNotifier(crowi).notifyReviewResult({
        proposal,
        reviewer: users.reviewer,
        activityId: new mongoose.Types.ObjectId().toString(),
        decision: { kind: 'whole-rejection' },
      }),
    ).resolves.toBeUndefined();
  });
});
