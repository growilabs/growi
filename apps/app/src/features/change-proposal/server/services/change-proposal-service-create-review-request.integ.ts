import type { IUserHasId } from '@growi/core';
import { GroupType, getIdStringForRef, PageGrant } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument } from '~/server/models/page';
import UserGroup from '~/server/models/user-group';
import UserGroupRelation from '~/server/models/user-group-relation';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type {
  ReviewerInput,
  ReviewerRef,
  ReviewRequestNotificationSnapshot,
} from '../../interfaces';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from './change-proposal-service';
import type { CreateProposalRequest } from './change-proposal-service-types';
import { createApplierTestKit } from './proposal-applier.test-kit';

const TEST_IP = '10.0.0.155';
const PREFIX = '/cp-service-create-review-request-integ';
const GROUP_NAME = 'cpServiceCreateReviewRequestGroup';

describe('ChangeProposalService.createProposal: the review request notification', () => {
  let crowi: Crowi;
  let service: ChangeProposalService;
  let groupId: string;
  let hiddenPage: HydratedDocument<PageDocument>;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpServiceCreateReviewRequestRequester',
      subscriber: 'cpServiceCreateReviewRequestSubscriber',
      other: 'cpServiceCreateReviewRequestOther',
    },
  });
  const { users } = kit;
  const now = new Date();

  const idOf = (user: IUserHasId): string => user._id.toString();
  const userInput = (user: IUserHasId): ReviewerInput => ({
    kind: 'user',
    id: idOf(user),
  });

  const create = (overrides: Partial<CreateProposalRequest> = {}) =>
    service.createProposal({
      requester: users.requester,
      entry: 'ai-chat',
      operations: [{ type: 'create', path: kit.nextPath('new'), body: 'x' }],
      request: { ip: TEST_IP },
      ...overrides,
    });

  const editHidden = () => {
    if (hiddenPage.revision == null) {
      throw new Error('fixture broken');
    }
    return {
      type: 'edit',
      pageId: hiddenPage._id.toString(),
      baseRevisionId: getIdStringForRef(hiddenPage.revision),
      body: 'edited hidden',
    } as const;
  };

  const createdId = (
    result: Awaited<ReturnType<ChangeProposalService['createProposal']>>,
  ): string => {
    if (!result.ok) {
      throw new Error(`not created: ${JSON.stringify(result.error)}`);
    }
    return result.value.proposalId;
  };

  const notificationsOf = (proposalId: string) =>
    InAppNotification.find({ target: proposalId }).lean().exec();

  const recipientIds = (
    notifications: Awaited<ReturnType<typeof notificationsOf>>,
  ) => notifications.map((n) => n.user.toString()).sort();

  // The id the create activity was recorded under.
  const createActivityIds = (emit: { mock: { calls: unknown[][] } }) =>
    emit.mock.calls
      .filter(
        ([event, , data]) =>
          event === 'update' &&
          data instanceof Object &&
          'action' in data &&
          data.action === SupportedAction.ACTION_CHANGE_PROPOSAL_CREATE,
      )
      .map(([, activityId]) => String(activityId));

  const storeSettledBase = async (
    reviewers: readonly ReviewerRef[],
  ): Promise<{ failedKey: string; id: string }> => {
    const base = await kit.storeProposal(
      [
        {
          type: 'move',
          pageId: new mongoose.Types.ObjectId().toString(),
          fromPath: kit.nextPath('gone'),
          toPath: kit.nextPath('gone-dst'),
        },
      ],
      { reviewers },
    );
    await kit.newApplier().apply(base._id, { kind: 'background' });
    const settled = await kit.reload(base._id);
    const [move] = settled.operations;
    if (move.status !== 'failed') {
      throw new Error('fixture broken');
    }
    return { failedKey: move.key, id: base._id };
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    groupId = (await UserGroup.create({ name: GROUP_NAME }))._id.toString();
    await UserGroupRelation.create({
      relatedGroup: groupId,
      relatedUser: users.requester._id,
    });
    const created = await crowi.pageService.create(
      kit.nextPath('group-only'),
      'hidden body',
      users.requester,
      {
        grant: PageGrant.GRANT_USER_GROUP,
        grantUserGroupIds: [{ item: groupId, type: GroupType.userGroup }],
      },
    );
    await kit.waitForPageOperationsToFinish();
    hiddenPage = await kit.findPage(created._id);
    service = createChangeProposalService(crowi, {
      applier: kit.newApplier(),
      now: () => now,
    });
  });

  beforeEach(async () => {
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
    await configManager.updateConfigs({
      'app:changeProposalReviewersEnabled': true,
    });
  });

  afterEach(async () => {
    await kit.waitForPageOperationsToFinish();
    vi.restoreAllMocks();
    await configManager.updateConfigs(
      {
        'app:changeProposalReviewersEnabled': undefined,
        'changeProposal:autoApplyPolicy': undefined,
      },
      { removeIfUndefined: true },
    );
  });

  afterAll(async () => {
    const userIds = Object.values(users).map((u) => u._id);
    await InAppNotification.deleteMany({ user: { $in: userIds } });
    await prisma.changeproposals.deleteMany({
      where: { requester: idOf(users.requester) },
    });
    await UserGroupRelation.deleteMany({ relatedGroup: groupId });
    await UserGroup.deleteMany({ name: GROUP_NAME });
    await kit.tearDown();
  });

  it('sends nothing when no reviewers are given (Req 20.1)', async () => {
    const proposalId = createdId(await create());

    expect(await notificationsOf(proposalId)).toEqual([]);
  });

  it('sends nothing when the requester alone is the reviewer, which still auto-applies (Req 20.1)', async () => {
    await configManager.updateConfigs({
      'changeProposal:autoApplyPolicy': 'all',
    });

    const proposalId = createdId(
      await create({ reviewers: [userInput(users.requester)] }),
    );

    expect(await notificationsOf(proposalId)).toEqual([]);
  });

  it('notifies each individual reviewer once with the id and the action of the create activity, and not the requester (Req 20.1)', async () => {
    const emit = vi.spyOn(crowi.events.activity, 'emit');

    const proposalId = createdId(
      await create({
        reviewers: [
          userInput(users.other),
          userInput(users.subscriber),
          userInput(users.requester),
          { kind: 'user-group', id: groupId },
        ],
      }),
    );

    const notifications = await notificationsOf(proposalId);
    expect(recipientIds(notifications)).toEqual(
      [idOf(users.other), idOf(users.subscriber)].sort(),
    );
    const activityIds = createActivityIds(emit);
    expect(activityIds).toHaveLength(1);
    for (const n of notifications) {
      expect(n).toMatchObject({
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_CREATE,
      });
      expect(n.activities.map(String)).toEqual(activityIds);
    }
  });

  it('keeps the pages a reviewer cannot view out of the notification (Req 20.3)', async () => {
    const visible = kit.nextPath('visible');

    const proposalId = createdId(
      await create({
        reviewers: [userInput(users.other), userInput(users.subscriber)],
        operations: [
          { type: 'create', path: visible, body: 'x' },
          editHidden(),
        ],
      }),
    );

    const notifications = await notificationsOf(proposalId);
    const raw = JSON.stringify(notifications);
    expect(raw).not.toContain(hiddenPage.path);
    expect(raw).not.toContain(hiddenPage._id.toString());
    expect(recipientIds(notifications)).toEqual(
      [idOf(users.other), idOf(users.subscriber)].sort(),
    );
    const snapshot: ReviewRequestNotificationSnapshot = JSON.parse(
      notifications[0].snapshot,
    );
    expect(snapshot.pages).toEqual([{ path: visible }]);
  });

  it('sends nothing to a reviewer who can decide none of the operations (Req 20.4)', async () => {
    const proposalId = createdId(
      await create({
        reviewers: [userInput(users.other)],
        operations: [editHidden()],
      }),
    );

    expect(await notificationsOf(proposalId)).toEqual([]);
  });

  it('still creates the proposal when saving the notification fails (Req 20.1)', async () => {
    vi.spyOn(InAppNotification, 'insertMany').mockRejectedValue(
      new Error('insert failed'),
    );

    const result = await create({ reviewers: [userInput(users.other)] });

    const proposalId = createdId(result);
    expect((await kit.reload(proposalId)).reviewers).toHaveLength(1);
  });

  describe('follow-up', () => {
    const base = async () =>
      storeSettledBase([
        {
          ...userInput(users.other),
          addedBy: idOf(users.subscriber),
          addedAt: new Date(now.getTime() - 60_000),
        },
        {
          ...userInput(users.subscriber),
          addedBy: idOf(users.requester),
          addedAt: new Date(now.getTime() - 60_000),
          removedBy: idOf(users.requester),
          removedAt: new Date(now.getTime() - 30_000),
        },
      ]);

    it('notifies the inherited active reviewers, including one the base had added by another user (Req 20.1)', async () => {
      const { id, failedKey } = await base();

      const proposalId = createdId(
        await create({
          basedOn: {
            proposalId: id,
            relation: 'follow-up',
            operationKeys: [failedKey],
          },
          operations: [
            { type: 'create', path: kit.nextPath('follow'), body: 'x' },
          ],
        }),
      );

      expect(recipientIds(await notificationsOf(proposalId))).toEqual([
        idOf(users.other),
      ]);
    });

    it('sends nothing when the follow-up drops the inherited reviewers with an empty list (Req 20.1)', async () => {
      const { id, failedKey } = await base();

      const proposalId = createdId(
        await create({
          basedOn: {
            proposalId: id,
            relation: 'follow-up',
            operationKeys: [failedKey],
          },
          reviewers: [],
        }),
      );

      expect(await notificationsOf(proposalId)).toEqual([]);
    });
  });
});
