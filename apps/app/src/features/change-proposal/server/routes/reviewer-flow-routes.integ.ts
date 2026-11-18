import type { IUserHasId } from '@growi/core';
import { getIdStringForRef } from '@growi/core';
import mongoose, { type HydratedDocument, type Types } from 'mongoose';

import { SupportedAction } from '~/interfaces/activity';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type {
  CreatableOperationInput,
  ReviewResultNotificationSnapshot,
} from '../../interfaces';
import type { CreateProposalRequest } from '../services/change-proposal-service-types';
import { createReviewerRoutesTestKit } from './reviewer-routes.test-kit';

const TEST_IP = '10.0.0.196';
const COMMENT = 'please keep the old heading';

describe('the reviewer flow through the routes', () => {
  const t = createReviewerRoutesTestKit({
    prefix: '/cp-reviewer-flow-routes-integ',
    ip: TEST_IP,
    usernameBase: 'cpReviewerFlowRoutes',
  });
  const { kit, users, asUser, idOf, userInput } = t;
  // users.subscriber is named as a reviewer; users.other is a reviewer only
  // through the group it belongs to.
  let groupId: Types.ObjectId;
  const createdIds: string[] = [];

  const editOf = (
    page: HydratedDocument<PageDocument>,
    body: string,
  ): CreatableOperationInput => {
    if (page.revision == null) throw new Error(`${page.path} has no revision`);
    return {
      type: 'edit',
      pageId: page._id.toString(),
      baseRevisionId: getIdStringForRef(page.revision),
      body,
    };
  };

  const create = async (
    request: Omit<CreateProposalRequest, 'requester' | 'entry'>,
  ) => {
    const result = await t.getService().createProposal({
      requester: users.requester,
      entry: 'ai-chat',
      request: { ip: TEST_IP },
      ...request,
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    createdIds.push(result.value.proposalId);
    return result.value;
  };

  const latestRevisionOf = async (page: HydratedDocument<PageDocument>) => {
    const current = await kit.findPage(page._id);
    return prisma.revisions.findUnique({
      where: { id: current.revision?.toString() },
    });
  };

  const notificationsTo = async (
    user: IUserHasId,
    proposalId: string,
    action: string,
  ) =>
    InAppNotification.find({ user: user._id, target: proposalId, action })
      .sort({ _id: 1 })
      .lean()
      .exec();

  const queuedIdsOf = async (user: IUserHasId): Promise<string[]> => {
    asUser(user);
    const res = await t.getQueue({ limit: '50' });
    expect(res.status).toBe(200);
    return res.body.items.map((item: { id: string }) => item.id);
  };

  const activityRowsOf = (proposalId: string) =>
    prisma.activities.findMany({ where: { target: proposalId } });

  beforeAll(async () => {
    groupId = (
      await mongoose.model('UserGroup').create({ name: 'cpReviewerFlowGroup' })
    )._id;
    await mongoose
      .model('UserGroupRelation')
      .create({ relatedGroup: groupId, relatedUser: users.other._id });
  });

  beforeEach(() =>
    configManager.updateConfigs({ 'changeProposal:autoApplyPolicy': 'all' }),
  );

  afterAll(async () => {
    await configManager.updateConfigs(
      { 'changeProposal:autoApplyPolicy': undefined },
      { removeIfUndefined: true },
    );
    await InAppNotification.deleteMany({ target: { $in: createdIds } });
    await prisma.activities.deleteMany({
      where: { target: { in: createdIds } },
    });
    await prisma.changeproposals.deleteMany({
      where: { id: { in: createdIds } },
    });
    await mongoose
      .model('UserGroupRelation')
      .deleteMany({ relatedGroup: groupId });
    await mongoose.model('UserGroup').deleteMany({ _id: groupId });
  });

  it('waits for the reviewers, and a group member approving what another reviewer rejected applies it as the requester, with the notifications and activities (Reviewers Req 1.11, 2.1, 2.4, 3.9, 6.1, 6.2, 6.5, 6.8, 7.2)', async () => {
    const first = await kit.createPage('flow-first');
    const second = await kit.createPage('flow-second');

    const { proposalId, apply } = await create({
      operations: [
        editOf(first, 'first by the proposal'),
        editOf(second, 'second by the proposal'),
      ],
      reviewers: [
        userInput(users.subscriber),
        { kind: 'user-group', id: groupId.toString() },
      ],
    });
    const [firstKey, secondKey] = (await kit.reload(proposalId)).operations.map(
      (op) => op.key,
    );

    expect(apply).toBeNull();
    expect(
      (await kit.reload(proposalId)).operations.map((op) => op.status),
    ).toEqual(['pending', 'pending']);
    expect(
      await notificationsTo(
        users.subscriber,
        proposalId,
        SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEW_REQUEST,
      ),
    ).toHaveLength(1);
    expect(
      await notificationsTo(
        users.other,
        proposalId,
        SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEW_REQUEST,
      ),
    ).toEqual([]);

    asUser(users.subscriber);
    const rejected = await t.postReview(proposalId, {
      kind: 'reject',
      operationKeys: [firstKey],
      comment: COMMENT,
    });
    expect(rejected.status).toBe(200);

    expect(await queuedIdsOf(users.other)).toContain(proposalId);
    const read = await t.getProposal(proposalId);
    expect(read.body.proposal).toMatchObject({ viewerRole: 'reviewer' });
    const approved = await t.postAction(proposalId, 'approve');

    expect(approved.status).toBe(200);
    expect(approved.body.result).toEqual({
      type: 'done',
      results: [
        { key: firstKey, status: 'applied' },
        { key: secondKey, status: 'applied' },
      ],
    });
    for (const [page, body] of [
      [first, 'first by the proposal'],
      [second, 'second by the proposal'],
    ] as const) {
      // biome-ignore lint/performance/noAwaitInLoops: two pages
      expect(await latestRevisionOf(page)).toMatchObject({
        body,
        authorId: idOf(users.requester),
      });
    }
    expect((await kit.reload(proposalId)).operations).toEqual([
      expect.objectContaining({
        approvedBy: idOf(users.other),
        approvedChannel: 'ui',
      }),
      expect.objectContaining({
        approvedBy: idOf(users.other),
        approvedChannel: 'ui',
      }),
    ]);
    expect(await queuedIdsOf(users.subscriber)).not.toContain(proposalId);

    await vi.waitFor(
      async () => {
        const rows = await activityRowsOf(proposalId);
        expect(
          rows.map((row) => [row.action, row.userId, row.ip ?? '']).sort(),
        ).toEqual(
          [
            [
              SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
              idOf(users.requester),
              '',
            ],
            [
              SupportedAction.ACTION_CHANGE_PROPOSAL_APPROVE,
              idOf(users.other),
              TEST_IP,
            ],
            [
              SupportedAction.ACTION_CHANGE_PROPOSAL_REJECT,
              idOf(users.subscriber),
              TEST_IP,
            ],
          ].sort(),
        );
      },
      { timeout: 3000, interval: 50 },
    );
    const results = await notificationsTo(
      users.requester,
      proposalId,
      SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEW_RESULT,
    );
    expect(
      results.map(
        (n) => JSON.parse(n.snapshot) as ReviewResultNotificationSnapshot,
      ),
    ).toEqual([
      expect.objectContaining({
        reviewer: {
          id: idOf(users.subscriber),
          username: users.subscriber.username,
        },
        items: [{ path: first.path, result: 'rejected', comment: COMMENT }],
      }),
      expect.objectContaining({
        reviewer: { id: idOf(users.other), username: users.other.username },
        items: [
          { path: first.path, result: 'approved' },
          { path: second.path, result: 'approved' },
        ],
      }),
    ]);
  });

  it('sends a rework back to the reviewers of its base, who approve it as the requester (Reviewers Req 6.1, 7.2, 8.4, 8.5)', async () => {
    const page = await kit.createPage('rework');
    const base = await create({
      operations: [editOf(page, 'base change')],
      reviewers: [userInput(users.subscriber)],
    });
    asUser(users.subscriber);
    expect((await t.postAction(base.proposalId, 'approve')).status).toBe(200);
    const [baseKey] = (await kit.reload(base.proposalId)).operations.map(
      (op) => op.key,
    );

    const rework = await create({
      operations: [editOf(await kit.findPage(page._id), 'reworked change')],
      basedOn: {
        proposalId: base.proposalId,
        relation: 'rework',
        operationKeys: [baseKey],
      },
    });

    expect(rework.apply).toBeNull();
    expect((await kit.reload(rework.proposalId)).reviewers).toEqual([
      expect.objectContaining({
        kind: 'user',
        id: idOf(users.subscriber),
        addedBy: idOf(users.requester),
      }),
    ]);
    expect(
      await notificationsTo(
        users.subscriber,
        rework.proposalId,
        SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEW_REQUEST,
      ),
    ).toHaveLength(1);
    expect(await queuedIdsOf(users.subscriber)).toContain(rework.proposalId);

    const approved = await t.postAction(rework.proposalId, 'approve');

    expect(approved.body.result).toMatchObject({
      type: 'done',
      results: [{ status: 'applied' }],
    });
    expect(await latestRevisionOf(page)).toMatchObject({
      body: 'reworked change',
      authorId: idOf(users.requester),
    });
  });
});
