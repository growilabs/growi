import type { IUserHasId } from '@growi/core';
import type { HydratedDocument } from 'mongoose';
import mongoose from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction, SupportedTargetModel } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { UserStatus } from '~/server/models/user/conts';
import {
  beginActivity,
  pendingActivityContext,
} from '~/server/service/activity/index';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import { recordProposalActivity } from './proposal-activity';

const TEST_IP = '10.0.0.145';
const TEST_ENDPOINT = '/_api/v3/cp-proposal-activity-integ';
const REQUESTER_USERNAME = 'cpProposalActivityRequester';
const REVERTER_USERNAME = 'cpProposalActivityReverter';

describe('recordProposalActivity', () => {
  let crowi: Crowi;
  let requester: HydratedDocument<IUserHasId>;
  let reverter: HydratedDocument<IUserHasId>;

  const waitForActivity = (activityId: string) =>
    vi.waitFor(
      async () => {
        const row = await prisma.activities.findUnique({
          where: { id: activityId },
        });
        if (row == null) {
          throw new Error(`activity ${activityId} not recorded yet`);
        }
        return row;
      },
      { timeout: 5000, interval: 50 },
    );

  beforeAll(async () => {
    crowi = await getInstance();
    // Apply and revert must be recorded even with the audit log turned off (7.5).
    await configManager.updateConfigs({ 'app:auditLogEnabled': false });

    const User = mongoose.model<IUserHasId>('User');
    const createUser = (username: string) =>
      User.create({
        name: username,
        username,
        email: `${username}@example.com`,
        status: UserStatus.STATUS_ACTIVE,
      });
    requester = await createUser(REQUESTER_USERNAME);
    reverter = await createUser(REVERTER_USERNAME);
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
    await mongoose.model('User').deleteMany({
      username: { $in: [REQUESTER_USERNAME, REVERTER_USERNAME] },
    });
    await configManager.updateConfigs(
      { 'app:auditLogEnabled': undefined },
      { removeIfUndefined: true },
    );
  });

  it('records a background apply with the requester as the operator, even with the audit log off', async () => {
    const proposalId = new mongoose.Types.ObjectId().toString();
    const emit = vi.spyOn(crowi.events.activity, 'emit');

    const { activityId } = recordProposalActivity(crowi, {
      action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
      proposalId,
      operator: requester,
      trigger: { kind: 'background' },
      request: { ip: TEST_IP, endpoint: TEST_ENDPOINT },
    });

    // Without a target document the per-page in-app notification path stays idle;
    // the aggregated notification is ProposalNotifier's job.
    const updateCall = emit.mock.calls.find(([event]) => event === 'update');
    expect(updateCall).toHaveLength(3);
    emit.mockRestore();
    const row = await waitForActivity(activityId);
    expect(row).toMatchObject({
      action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
      targetModel: SupportedTargetModel.MODEL_CHANGE_PROPOSAL,
      target: proposalId,
      userId: requester._id.toString(),
      ip: TEST_IP,
      endpoint: TEST_ENDPOINT,
    });
    expect(row.snapshot?.username).toBe(REQUESTER_USERNAME);
  });

  it('records a background revert with the reverter as the operator', async () => {
    const proposalId = new mongoose.Types.ObjectId().toString();

    const { activityId } = recordProposalActivity(crowi, {
      action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT,
      proposalId,
      operator: reverter,
      trigger: { kind: 'background' },
      request: { ip: TEST_IP, endpoint: TEST_ENDPOINT },
    });

    const row = await waitForActivity(activityId);
    expect(row.action).toBe(SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT);
    expect(row.userId).toBe(reverter._id.toString());
    expect(row.target).toBe(proposalId);
  });

  it('settles the route activity on its id and keeps the operator although the response finishes right after', async () => {
    const proposalId = new mongoose.Types.ObjectId().toString();
    // What the add-activity middleware stashes for the request's operator.
    const { activityId: routeActivityId } = beginActivity({
      ip: TEST_IP,
      endpoint: TEST_ENDPOINT,
      userId: reverter._id.toString(),
      username: reverter.username,
      createdAt: new Date(),
    });

    const { activityId } = recordProposalActivity(crowi, {
      action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT,
      proposalId,
      operator: reverter,
      trigger: { kind: 'request', activityId: routeActivityId },
    });
    // The response's finish clears the stashed context.
    pendingActivityContext.clear(routeActivityId);

    expect(activityId).toBe(routeActivityId);
    const row = await waitForActivity(routeActivityId);
    expect(row).toMatchObject({
      action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT,
      targetModel: SupportedTargetModel.MODEL_CHANGE_PROPOSAL,
      target: proposalId,
      userId: reverter._id.toString(),
      ip: TEST_IP,
    });
  });

  it('clears the context it created when the emit throws', () => {
    const emit = vi
      .spyOn(crowi.events.activity, 'emit')
      .mockImplementationOnce(() => {
        throw new Error('listener failure');
      });

    const { activityId } = recordProposalActivity(crowi, {
      action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
      proposalId: new mongoose.Types.ObjectId().toString(),
      operator: requester,
      trigger: { kind: 'background' },
    });

    expect(emit).toHaveBeenCalledWith('update', activityId, expect.anything());
    // Nothing took the context, so only the failure cleanup can have removed it.
    expect(pendingActivityContext.take(activityId)).toBeUndefined();
    emit.mockRestore();
  });
});
