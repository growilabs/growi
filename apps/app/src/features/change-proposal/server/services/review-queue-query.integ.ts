import type { IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import ExternalUserGroup from '~/features/external-user-group/server/models/external-user-group';
import ExternalUserGroupRelation from '~/features/external-user-group/server/models/external-user-group-relation';
import type { PageDocument, PageModel } from '~/server/models/page';
import { UserStatus } from '~/server/models/user/conts';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';
import { prisma } from '~/utils/prisma';

import type {
  ChangeProposalDocument,
  ChangeProposalSummaryView,
  ReviewerKind,
  ReviewerRef,
} from '../../interfaces';
import type { ViewerIdentity } from '../domain';
import type { CreateOperationInput } from '../models/change-proposal-types';
import {
  createReviewQueueQuery,
  isReviewQueueCursor,
  type ReviewQueueQuery,
} from './review-queue-query';
import { loadViewerIdentity } from './reviewer-identity';

const PREFIX = '/cp-review-queue-query-integ';
const PURPOSE = 'why this change is proposed';
const MAX_PAGES_TO_FOLLOW = 20;

type Reviewer = {
  readonly user: HydratedDocument<IUserHasId>;
  readonly identity: ViewerIdentity;
  readonly groupId: string;
  readonly externalGroupId: string;
};

describe('listReviewQueue', () => {
  let Page: PageModel;
  let requester: HydratedDocument<IUserHasId>;
  let seq = 0;
  const userIds: string[] = [];
  const groupIds: string[] = [];
  const externalGroupIds: string[] = [];
  const proposalIds: string[] = [];

  const proposals = () => mongoose.connection.collection('changeproposals');
  const objectIdOf = (id: string) => new mongoose.Types.ObjectId(id);

  const newUser = async (label: string) => {
    seq += 1;
    const username = `cpQueue${label}${seq}`;
    const user = await mongoose.model<IUserHasId>('User').create({
      name: username,
      username,
      email: `${username}@example.com`,
      status: UserStatus.STATUS_ACTIVE,
    });
    userIds.push(user._id.toString());
    return user;
  };

  // A fresh reviewer per test: the queue spans the worker DB, and a new
  // reviewer is named on this test's proposals alone.
  const newReviewer = async (): Promise<Reviewer> => {
    const user = await newUser('Reviewer');
    const group = await UserGroup.create({ name: `cpQueueGroup${seq}` });
    const externalGroup = await ExternalUserGroup.create({
      name: `cpQueueExternalGroup${seq}`,
      externalId: `cp-queue-external-${seq}`,
      provider: 'ldap',
    });
    groupIds.push(group._id.toString());
    externalGroupIds.push(externalGroup._id.toString());
    await UserGroupRelation.create({
      relatedGroup: group._id,
      relatedUser: user._id,
    });
    await ExternalUserGroupRelation.create({
      relatedGroup: externalGroup._id,
      relatedUser: user._id,
    });
    return {
      user,
      identity: await loadViewerIdentity(user._id.toString()),
      groupId: group._id.toString(),
      externalGroupId: externalGroup._id.toString(),
    };
  };

  const createPage = (
    access: 'public' | 'hidden',
    label: string,
  ): Promise<HydratedDocument<PageDocument>> => {
    seq += 1;
    return Page.create({
      path: `${PREFIX}/${label}-${seq}`,
      ...(access === 'public'
        ? { grant: PageGrant.GRANT_PUBLIC }
        : { grant: PageGrant.GRANT_OWNER, grantedUsers: [requester._id] }),
    });
  };

  const edit = (
    page: HydratedDocument<PageDocument>,
  ): CreateOperationInput => ({
    type: 'edit',
    pageId: page._id.toString(),
    baseRevisionId: new mongoose.Types.ObjectId().toString(),
    body: 'proposed body',
  });

  const reviewerRef = (kind: ReviewerKind, id: string): ReviewerRef => ({
    kind,
    id,
    addedBy: requester._id.toString(),
    addedAt: new Date(),
  });

  const naming = (reviewer: Reviewer): ReviewerRef =>
    reviewerRef('user', reviewer.user._id.toString());

  const store = async (
    operations: readonly CreateOperationInput[],
    reviewers: readonly ReviewerRef[],
    requesterId: string = requester._id.toString(),
  ): Promise<ChangeProposalDocument> => {
    const created = await prisma.changeproposals.createProposal({
      requester: requesterId,
      entry: 'ai-chat',
      perPageNotifications: false,
      purpose: PURPOSE,
      reviewers,
      operations,
    });
    proposalIds.push(created._id);
    return created;
  };

  // Pending only on a page the reviewer cannot view.
  const storeWithoutTarget = async (reviewer: Reviewer) =>
    store([edit(await createPage('hidden', 'no-target'))], [naming(reviewer)]);

  const storeWithTarget = async (reviewer: Reviewer) =>
    store([edit(await createPage('public', 'target'))], [naming(reviewer)]);

  const idsOf = (items: readonly ChangeProposalSummaryView[]): string[] =>
    items.map((item) => item.id);

  // Follows the cursor to the end and returns the ids of each page.
  const followAll = async (
    query: ReviewQueueQuery,
    identity: ViewerIdentity,
    limit: number,
  ): Promise<string[][]> => {
    const pages: string[][] = [];
    let cursor: string | null = null;
    for (let i = 0; i < MAX_PAGES_TO_FOLLOW; i += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: following the cursor page by page
      const page = await query.listReviewQueue(identity, cursor, limit);
      pages.push(idsOf(page.items));
      if (page.nextCursor == null) {
        return pages;
      }
      cursor = page.nextCursor;
    }
    throw new Error('the cursor never ran out');
  };

  beforeAll(async () => {
    await getInstance();
    Page = mongoose.model<PageDocument, PageModel>('Page');
    requester = await newUser('Requester');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.changeproposals.deleteMany({
      where: { id: { in: proposalIds } },
    });
    await Page.deleteMany({ path: new RegExp(`^${PREFIX}(/|$)`) });
    await UserGroupRelation.deleteMany({ relatedGroup: { $in: groupIds } });
    await ExternalUserGroupRelation.deleteMany({
      relatedGroup: { $in: externalGroupIds },
    });
    await UserGroup.deleteMany({ _id: { $in: groupIds } });
    await ExternalUserGroup.deleteMany({ _id: { $in: externalGroupIds } });
    await mongoose.model('User').deleteMany({ _id: { $in: userIds } });
  });

  it('lists the open proposals naming the viewer, a group or an external group of the viewer, oldest first (Reviewers Req 5.5)', async () => {
    const reviewer = await newReviewer();
    const page = await createPage('public', 'named');
    const byUser = await store([edit(page)], [naming(reviewer)]);
    const byGroup = await store(
      [edit(page)],
      [reviewerRef('user-group', reviewer.groupId)],
    );
    const byExternalGroup = await store(
      [edit(page)],
      [reviewerRef('external-user-group', reviewer.externalGroupId)],
    );

    const { items, nextCursor } =
      await createReviewQueueQuery().listReviewQueue(
        reviewer.identity,
        null,
        10,
      );

    expect(idsOf(items)).toEqual([
      byUser._id,
      byGroup._id,
      byExternalGroup._id,
    ]);
    expect(nextCursor).toBeNull();
  });

  it('shows each item as a reviewer sees it, with the purpose and the reviewers but nothing only the requester gets (Reviewers Req 5.5)', async () => {
    const reviewer = await newReviewer();
    const page = await createPage('public', 'as-reviewer');
    const proposal = await store([edit(page)], [naming(reviewer)]);

    const { items } = await createReviewQueueQuery().listReviewQueue(
      reviewer.identity,
      null,
      10,
    );

    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item).toMatchObject({
      id: proposal._id,
      viewerRole: 'reviewer',
      isRequester: false,
      status: 'pending',
      purpose: PURPOSE,
      requester: { id: requester._id.toString() },
      pages: [{ id: page._id.toString(), path: page.path }],
      reviewers: [{ kind: 'user', id: reviewer.user._id.toString() }],
    });
    expect(item).not.toHaveProperty('requesterState');
    expect(item).not.toHaveProperty('wholeRejections');
  });

  it('leaves out proposals with no decision target for the viewer, and proposals the viewer is no longer a reviewer of (Reviewers Req 5.5, 5.6)', async () => {
    const reviewer = await newReviewer();
    const other = await newReviewer();
    await storeWithoutTarget(reviewer);
    const failedVisibleAndPendingHidden = await store(
      [
        edit(await createPage('public', 'failed')),
        edit(await createPage('hidden', 'pending-hidden')),
      ],
      [naming(reviewer)],
    );
    await proposals().updateOne(
      { _id: objectIdOf(failedVisibleAndPendingHidden._id) },
      {
        $set: {
          'operations.0.status': 'failed',
          'operations.0.reason': 'target-unavailable',
        },
      },
    );
    const withdrawn = await storeWithTarget(reviewer);
    await proposals().updateOne(
      { _id: objectIdOf(withdrawn._id) },
      { $set: { lifecycle: 'withdrawn' } },
    );
    const removed = await storeWithTarget(reviewer);
    await proposals().updateOne(
      { _id: objectIdOf(removed._id) },
      {
        $set: {
          'reviewers.0.removedAt': new Date(),
          'reviewers.0.removedBy': objectIdOf(requester._id.toString()),
        },
      },
    );
    await store(
      [edit(await createPage('public', 'someone-else'))],
      [naming(other)],
    );
    const listed = await storeWithTarget(reviewer);

    const { items } = await createReviewQueueQuery().listReviewQueue(
      reviewer.identity,
      null,
      10,
    );

    expect(idsOf(items)).toEqual([listed._id]);
  });

  it('leaves out a proposal the viewer requested, even when naming themselves (Reviewers Req 5.5)', async () => {
    const reviewer = await newReviewer();
    await store(
      [edit(await createPage('public', 'own'))],
      [naming(reviewer)],
      reviewer.user._id.toString(),
    );

    const { items } = await createReviewQueueQuery().listReviewQueue(
      reviewer.identity,
      null,
      10,
    );

    expect(items).toEqual([]);
  });

  it('pages through every listed proposal once, oldest first, by the cursor (Reviewers Req 5.5)', async () => {
    const reviewer = await newReviewer();
    const first = await storeWithTarget(reviewer);
    const second = await storeWithTarget(reviewer);
    const third = await storeWithTarget(reviewer);

    const pages = await followAll(
      createReviewQueueQuery(),
      reviewer.identity,
      1,
    );

    expect(pages.flat()).toEqual([first._id, second._id, third._id]);
    expect(pages.slice(0, 3)).toEqual([[first._id], [second._id], [third._id]]);
  });

  it('stops at the scan budget with the last scanned proposal as the cursor, and goes on from there (Reviewers Req 5.5)', async () => {
    const reviewer = await newReviewer();
    const scanned: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: proposals created in order
      scanned.push((await storeWithoutTarget(reviewer))._id);
    }
    const listed = await storeWithTarget(reviewer);
    const query = createReviewQueueQuery({ batchSize: 2, limit: 3 });

    const firstPage = await query.listReviewQueue(reviewer.identity, null, 10);
    expect(firstPage).toEqual({ items: [], nextCursor: scanned[2] });

    const secondPage = await query.listReviewQueue(
      reviewer.identity,
      firstPage.nextCursor,
      10,
    );
    expect(idsOf(secondPage.items)).toEqual([listed._id]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it.each([
    ['a cursor that is not an id', 'not-an-object-id', 10],
    [
      'a cursor one character too long',
      `${new mongoose.Types.ObjectId().toString()}0`,
      10,
    ],
    ['a zero limit', null, 0],
    ['a fractional limit', null, 1.5],
  ] as const)('answers %s with an empty page (Reviewers Req 5.5)', async (_label, cursor, limit) => {
    const reviewer = await newReviewer();
    await storeWithTarget(reviewer);

    expect(
      await createReviewQueueQuery().listReviewQueue(
        reviewer.identity,
        cursor,
        limit,
      ),
    ).toEqual({ items: [], nextCursor: null });
  });

  it('tells a well-formed cursor from a malformed one, for the route to reject with 400 (Reviewers Req 5.5)', () => {
    const id = new mongoose.Types.ObjectId().toString();
    expect(isReviewQueueCursor(id)).toBe(true);
    expect(isReviewQueueCursor(id.toUpperCase())).toBe(false);
    expect(isReviewQueueCursor(`${id}0`)).toBe(false);
    expect(isReviewQueueCursor('')).toBe(false);
  });

  it('shows a proposal with operations on pages the viewer cannot view exactly like one without them (Reviewers Req 5.6)', async () => {
    const reviewer = await newReviewer();
    const hidden = await createPage('hidden', 'hidden-edit');
    const hiddenParent = await createPage('hidden', 'hidden-parent');
    const moveSource = await createPage('public', 'move-source');
    const plainPage = await createPage('public', 'plain');
    const mixedPage = await createPage('public', 'mixed');
    const plain = await store([edit(plainPage)], [naming(reviewer)]);
    const mixed = await store(
      [
        edit(hidden),
        edit(mixedPage),
        // The source is viewable, the destination's parent is not.
        {
          type: 'move',
          pageId: moveSource._id.toString(),
          fromPath: moveSource.path,
          toPath: `${hiddenParent.path}/moved`,
        },
      ],
      [naming(reviewer)],
    );

    const { items } = await createReviewQueueQuery().listReviewQueue(
      reviewer.identity,
      null,
      10,
    );

    const itemOf = (id: string) => {
      const item = items.find((i) => i.id === id);
      if (item == null) throw new Error(`${id} is not listed`);
      return item;
    };
    const comparable = ({
      id: _id,
      createdAt: _createdAt,
      pages: _pages,
      reviewers,
      ...rest
    }: ChangeProposalSummaryView) => ({
      ...rest,
      reviewers: reviewers?.map(({ addedAt: _addedAt, ...r }) => r),
    });
    expect(comparable(itemOf(mixed._id))).toEqual(
      comparable(itemOf(plain._id)),
    );
    expect(itemOf(mixed._id).pages).toEqual([
      { id: mixedPage._id.toString(), path: mixedPage.path },
    ]);
    const serialized = JSON.stringify(itemOf(mixed._id));
    for (const page of [hidden, hiddenParent, moveSource]) {
      expect(serialized).not.toContain(page._id.toString());
      expect(serialized).not.toContain(page.path);
    }
  });

  it('reads no group membership and checks viewing once per scanned batch, not once per proposal (Reviewers Req 5.5)', async () => {
    const reviewer = await newReviewer();
    for (let i = 0; i < 4; i += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: proposals created in order
      await storeWithTarget(reviewer);
    }
    const membershipReads = [
      vi.spyOn(UserGroupRelation, 'findAllUserGroupIdsRelatedToUser'),
      vi.spyOn(ExternalUserGroupRelation, 'findAllUserGroupIdsRelatedToUser'),
    ];
    const viewingChecks = vi.spyOn(Page, 'findByIdsAndViewer');

    const { items } = await createReviewQueueQuery({
      batchSize: 2,
      limit: 100,
    }).listReviewQueue(reviewer.identity, null, 10);

    expect(items).toHaveLength(4);
    for (const spy of membershipReads) {
      expect(spy).not.toHaveBeenCalled();
    }
    expect(viewingChecks).toHaveBeenCalledTimes(2);
  });
});
