import type { IUserHasId } from '@growi/core';
import express from 'express';
import mongoose, { type HydratedDocument, Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import { UserStatus } from '~/server/models/user/conts';
import { setup as setupInAppNotificationRouter } from '~/server/routes/apiv3/in-app-notification';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { pendingActivityContext } from '~/server/service/activity/index';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import {
  type ChangeProposalDocument,
  REVERT_REQUEST_ERROR_CODES,
  REVERT_REQUEST_MESSAGE_MAX_LENGTH,
} from '../../interfaces';
import { createChangeProposalService } from '../services/change-proposal-service';
import { createApplierTestKit } from '../services/proposal-applier.test-kit';
import { createChangeProposalRouter } from '.';

const TEST_IP = '10.0.0.242';
const PREFIX = '/cp-revert-request-route-integ';
const MOUNT_PATH = '/_api/v3/change-proposals';
const NOTIFICATION_MOUNT_PATH = '/_api/v3/in-app-notification';
const BACKGROUND = { kind: 'background' } as const;
// Long enough for the fire-and-forget activity writes to land if they were going to.
const ABSENCE_WAIT_MS = 500;
const READ_ONLY_USERNAME = 'cpRevertRequestRouteReadOnly';
const SUSPENDED_USERNAME = 'cpRevertRequestRouteSuspended';

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('POST /change-proposals/:id/revert-request', () => {
  let crowi: Crowi;
  let app: express.Application;
  let currentUser: IUserHasId | undefined;
  let finishResponseImmediately = false;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpRevertRequestRouteRequester',
      subscriber: 'cpRevertRequestRouteSender',
      other: 'cpRevertRequestRouteOther',
    },
  });
  const { users } = kit;
  let readOnlyUser: HydratedDocument<IUserHasId>;
  const User = () => mongoose.model<IUserHasId>('User');

  const asUser = (user: IUserHasId | undefined) => {
    currentUser = user;
  };

  const endpointOf = (id: string) => `${MOUNT_PATH}/${id}/revert-request`;

  const send = (id: string, body: object = {}) =>
    request(app)
      .post(endpointOf(id))
      .set('X-Forwarded-For', TEST_IP)
      .send(body);

  const revertRequestsTo = (proposalId: string) =>
    InAppNotification.find({
      target: proposalId,
      action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT_REQUEST,
    })
      .lean()
      .exec();

  const activitiesAt = (endpoint: string) =>
    prisma.activities.findMany({ where: { ip: TEST_IP, endpoint } });

  const waitForActivitiesAt = (endpoint: string, count: number) =>
    vi.waitFor(
      async () => {
        const rows = await activitiesAt(endpoint);
        if (rows.length < count) {
          throw new Error(`${rows.length} activities at ${endpoint}`);
        }
        return rows;
      },
      { timeout: 5000, interval: 50 },
    );

  const expectNoActivityAt = async (endpoint: string) => {
    await sleep(ABSENCE_WAIT_MS);
    expect(await activitiesAt(endpoint)).toEqual([]);
  };

  const expectOneUnsettledAttempt = async (endpoint: string) => {
    const rows = await waitForActivitiesAt(endpoint, 1);
    await sleep(ABSENCE_WAIT_MS);
    expect(await activitiesAt(endpoint)).toHaveLength(1);
    expect(rows[0].action).toBe(SupportedAction.ACTION_UNSETTLED);
  };

  const appliedProposal = async (
    requester?: string,
  ): Promise<ChangeProposalDocument> => {
    const proposal = await kit.storeProposal(
      [kit.editInput(await kit.createPage('applied'))],
      { requester },
    );
    await kit.newApplier().apply(proposal._id, BACKGROUND, { ip: TEST_IP });
    await kit.waitForPageOperationsToFinish();
    return kit.reload(proposal._id);
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    // The revert-request activity must be recorded even with the audit log off.
    await configManager.updateConfigs({ 'app:auditLogEnabled': false });
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);

    readOnlyUser = await User().create({
      name: READ_ONLY_USERNAME,
      username: READ_ONLY_USERNAME,
      email: `${READ_ONLY_USERNAME}@example.com`,
      status: UserStatus.STATUS_ACTIVE,
      readOnly: true,
    });

    const responseHelpers: { response: Record<string, unknown> } = {
      response: {},
    };
    addCustomFunctionToResponse(responseHelpers);
    const { apiv3 } = responseHelpers.response;
    if (typeof apiv3 !== 'function') {
      throw new Error('res.apiv3 is not installed');
    }
    // Clears the pending activity context the moment the handler responds, as the
    // finalizer does when the response finishes at once: only an emit that ran
    // before the response keeps the operator on the settled row.
    const apiv3FinishingImmediately = function (
      this: express.Response,
      ...args: unknown[]
    ) {
      const activityId: unknown = this.locals.activity?._id;
      if (typeof activityId === 'string') {
        pendingActivityContext.clear(activityId);
      }
      return Reflect.apply(apiv3, this, args);
    };

    app = express();
    // Activity rows carry req.ip; the suite's rows are found and removed by TEST_IP.
    app.set('trust proxy', true);
    app.use(express.json());
    app.use((req: express.Request & { user?: IUserHasId }, res, next) => {
      Object.assign(
        res,
        responseHelpers.response,
        finishResponseImmediately ? { apiv3: apiv3FinishingImmediately } : {},
      );
      if (currentUser != null) {
        req.user = currentUser;
      }
      next();
    });
    app.use(
      MOUNT_PATH,
      createChangeProposalRouter(crowi, {
        service: createChangeProposalService(crowi, {
          applier: kit.newApplier(),
        }),
      }),
    );
    app.use(NOTIFICATION_MOUNT_PATH, setupInAppNotificationRouter(crowi));
  }, 120_000);

  beforeEach(() => {
    currentUser = undefined;
    finishResponseImmediately = false;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await User().deleteMany({
      username: { $in: [READ_ONLY_USERNAME, SUSPENDED_USERNAME] },
    });
    await configManager.updateConfigs(
      { 'app:auditLogEnabled': undefined },
      { removeIfUndefined: true },
    );
    await kit.tearDown();
  }, 60_000);

  it('sends one notification to the requester and records the activity with the sender as the operator, even with the audit log off', async () => {
    const proposal = await appliedProposal();
    asUser(users.subscriber);

    const res = await send(proposal._id, { message: 'please revert the rest' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
    const notifications = await revertRequestsTo(proposal._id);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].user.toString()).toBe(
      users.requester._id.toString(),
    );
    const endpoint = endpointOf(proposal._id);
    const [row] = await waitForActivitiesAt(endpoint, 1);
    await sleep(ABSENCE_WAIT_MS);
    expect(await activitiesAt(endpoint)).toHaveLength(1);
    expect(row).toMatchObject({
      action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT_REQUEST,
      target: proposal._id,
      userId: users.subscriber._id.toString(),
    });
    expect(notifications[0].activities.map(String)).toEqual([row.id]);
  });

  it('keeps the sender as the operator even when the response finishes immediately', async () => {
    const proposal = await appliedProposal();
    asUser(users.subscriber);
    finishResponseImmediately = true;

    const res = await send(proposal._id);

    expect(res.status).toBe(200);
    // Found by id: a row settled without its request context has no ip or endpoint.
    const [notification] = await revertRequestsTo(proposal._id);
    const activityId = String(notification.activities[0]);
    const row = await vi.waitFor(
      async () => {
        const found = await prisma.activities.findUnique({
          where: { id: activityId },
        });
        if (found == null) {
          throw new Error(`activity ${activityId} not settled yet`);
        }
        return found;
      },
      { timeout: 3000, interval: 50 },
    );
    expect(row).toMatchObject({
      action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT_REQUEST,
      userId: users.subscriber._id.toString(),
    });
  });

  it('accepts a message of exactly the maximum length and an omitted message', async () => {
    const atLimit = await appliedProposal();
    const omitted = await appliedProposal();
    asUser(users.subscriber);
    const message = 'x'.repeat(REVERT_REQUEST_MESSAGE_MAX_LENGTH);

    const resAtLimit = await send(atLimit._id, { message });
    const resOmitted = await send(omitted._id);

    expect(resAtLimit.status).toBe(200);
    expect(resOmitted.status).toBe(200);
    const [notification] = await revertRequestsTo(atLimit._id);
    expect(JSON.parse(notification.snapshot).message).toBe(message);
    const [omittedNotification] = await revertRequestsTo(omitted._id);
    expect(JSON.parse(omittedNotification.snapshot).message).toBe('');
  });

  it.each([
    [
      'a message over the maximum length',
      { message: 'x'.repeat(REVERT_REQUEST_MESSAGE_MAX_LENGTH + 1) },
    ],
    ['a non-string message', { message: { $ne: null } }],
  ])('rejects %s with 400 validation_failed, sends nothing and records the attempt', async (_label, body) => {
    const proposal = await appliedProposal();
    asUser(users.subscriber);

    const res = await send(proposal._id, body);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('validation_failed');
    expect(await revertRequestsTo(proposal._id)).toHaveLength(0);
    await expectOneUnsettledAttempt(endpointOf(proposal._id));
  });

  it('refuses the requester asking themselves with 400 own_proposal', async () => {
    const proposal = await appliedProposal();
    asUser(users.requester);

    const res = await send(proposal._id);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe(
      REVERT_REQUEST_ERROR_CODES.ownProposal,
    );
    expect(await revertRequestsTo(proposal._id)).toHaveLength(0);
    await expectOneUnsettledAttempt(endpointOf(proposal._id));
  });

  it('refuses a requester who is no longer active with 400 requester_unavailable', async () => {
    const suspended = await User().create({
      name: SUSPENDED_USERNAME,
      username: SUSPENDED_USERNAME,
      email: `${SUSPENDED_USERNAME}@example.com`,
      status: UserStatus.STATUS_ACTIVE,
    });
    const proposal = await appliedProposal(suspended._id.toString());
    await User().updateOne(
      { _id: suspended._id },
      { status: UserStatus.STATUS_SUSPENDED },
    );
    asUser(users.subscriber);

    const res = await send(proposal._id);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe(
      REVERT_REQUEST_ERROR_CODES.requesterUnavailable,
    );
    expect(await revertRequestsTo(proposal._id)).toHaveLength(0);
  });

  it('refuses a second request within the cooldown with 409 and keeps a single notification', async () => {
    const proposal = await appliedProposal();
    asUser(users.subscriber);
    const first = await send(proposal._id);
    expect(first.status).toBe(200);
    await waitForActivitiesAt(endpointOf(proposal._id), 1);

    const second = await send(proposal._id);

    expect(second.status).toBe(409);
    expect(second.body.errors[0].code).toBe(
      REVERT_REQUEST_ERROR_CODES.recentlySent,
    );
    expect(await revertRequestsTo(proposal._id)).toHaveLength(1);
  });

  it('answers a missing, a malformed and an invisible proposal with one identical 404 notfound', async () => {
    const pending = await kit.storeProposal(
      [kit.editInput(await kit.createPage('pending'))],
      { approve: false },
    );
    asUser(users.subscriber);
    const ids = [
      new Types.ObjectId().toString(),
      'not-an-object-id',
      pending._id,
    ];

    const responses = await Promise.all(ids.map((id) => send(id)));

    for (const res of responses) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(responses[0].body);
    }
    expect(responses[0].body.errors[0].code).toBe('notfound');
    expect(await revertRequestsTo(pending._id)).toHaveLength(0);
  });

  it('rejects a read-only user without sending or recording anything', async () => {
    const proposal = await appliedProposal();
    asUser(readOnlyUser);

    const res = await send(proposal._id);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].code).toBe('validation_failed');
    expect(await revertRequestsTo(proposal._id)).toHaveLength(0);
    await expectNoActivityAt(endpointOf(proposal._id));
  });

  it('rejects an anonymous caller without sending or recording anything', async () => {
    const proposal = await appliedProposal();

    const res = await send(proposal._id);

    expect(res.status).toBe(403);
    expect(await revertRequestsTo(proposal._id)).toHaveLength(0);
    await expectNoActivityAt(endpointOf(proposal._id));
  });

  it('lists the revert request for the requester with the proposal id only as its target and the sender as its action user', async () => {
    const proposal = await appliedProposal();
    asUser(users.subscriber);
    expect((await send(proposal._id)).status).toBe(200);
    await waitForActivitiesAt(endpointOf(proposal._id), 1);

    asUser(users.requester);
    const res = await request(app)
      .get(`${NOTIFICATION_MOUNT_PATH}/list`)
      .query({ limit: 50 });

    expect(res.status).toBe(200);
    const doc = res.body.docs.find(
      (d: { action: string; target: { _id: string } }) =>
        d.action === SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT_REQUEST &&
        d.target._id === proposal._id,
    );
    expect(doc.target).toEqual({ _id: proposal._id });
    expect(
      doc.actionUsers.map((u: { username: string }) => u.username),
    ).toEqual([users.subscriber.username]);
  });
});
