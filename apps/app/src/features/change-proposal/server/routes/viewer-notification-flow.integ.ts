import { getIdStringForRef, type IUserHasId } from '@growi/core';
import express from 'express';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { InAppNotification } from '~/server/models/in-app-notification';
import { setup as setupInAppNotificationRouter } from '~/server/routes/apiv3/in-app-notification';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type {
  ChangeProposalNotificationSnapshot,
  ChangeProposalRevertRequestSnapshot,
} from '../../interfaces';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from '../services/change-proposal-service';
import { createApplierTestKit } from '../services/proposal-applier.test-kit';
import { createChangeProposalRouter } from '.';

const TEST_IP = '10.0.0.243';
const TEST_ENDPOINT = '/_api/v3/cp-viewer-notification-flow-integ';
const PREFIX = '/cp-viewer-notification-flow-integ';
const MOUNT_PATH = '/_api/v3/change-proposals';
const NOTIFICATION_MOUNT_PATH = '/_api/v3/in-app-notification';
const BACKGROUND = { kind: 'background' } as const;

type ListedNotification = {
  readonly action: string;
  readonly target: { readonly _id: string };
  readonly snapshot: string;
  readonly actionUsers: readonly { readonly username: string }[];
};

describe('change proposal notifications through the notification list API', () => {
  let crowi: Crowi;
  let app: express.Application;
  let service: ChangeProposalService;
  let currentUser: IUserHasId | undefined;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpViewerFlowRequester',
      subscriber: 'cpViewerFlowSecondUser',
      other: 'cpViewerFlowOther',
    },
  });
  const { users } = kit;

  const asUser = (user: IUserHasId | undefined) => {
    currentUser = user;
  };

  const listNotificationsOf = async (
    user: IUserHasId,
    proposalId: string,
  ): Promise<ListedNotification[]> => {
    asUser(user);
    const res = await request(app)
      .get(`${NOTIFICATION_MOUNT_PATH}/list`)
      .query({ limit: 50 });
    expect(res.status).toBe(200);
    return res.body.docs.filter(
      (doc: ListedNotification) => doc.target?._id === proposalId,
    );
  };

  // A proposal with one edit and one create, applied in a single run.
  const applyEditAndCreate = async (): Promise<string> => {
    const edited = await kit.createPage('edited');
    await kit.subscribe(edited);
    const created = await service.createProposal({
      requester: users.requester,
      entry: 'ai-chat',
      operations: [
        {
          type: 'edit',
          pageId: edited._id.toString(),
          baseRevisionId: getIdStringForRef(edited.revision ?? ''),
          body: 'proposed body',
        },
        { type: 'create', path: kit.nextPath('created'), body: 'new body' },
      ],
      request: { ip: TEST_IP, endpoint: TEST_ENDPOINT },
    });
    if (!created.ok) throw new Error(JSON.stringify(created.error));
    const { proposalId } = created.value;

    const applied = await service.approve(
      proposalId,
      users.requester,
      'all',
      BACKGROUND,
    );
    await kit.waitForPageOperationsToFinish();
    if (!applied.ok) throw new Error(JSON.stringify(applied.error));
    const stored = await kit.reload(proposalId);
    expect(stored.operations.map((op) => op.status)).toEqual([
      'applied',
      'applied',
    ]);
    return proposalId;
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    await configManager.updateConfigs({
      'changeProposal:autoApplyPolicy': 'none',
    });
    // Page events have async listeners (search, vault) unrelated to this test.
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);
    service = createChangeProposalService(crowi, {
      applier: kit.newApplier(),
    });

    const responseHelpers: { response: Record<string, unknown> } = {
      response: {},
    };
    addCustomFunctionToResponse(responseHelpers);

    app = express();
    // Activity rows carry req.ip; the kit removes the suite's rows by TEST_IP.
    app.set('trust proxy', true);
    app.use(express.json());
    app.use((req: express.Request & { user?: IUserHasId }, res, next) => {
      Object.assign(res, responseHelpers.response);
      if (currentUser != null) {
        req.user = currentUser;
      }
      next();
    });
    app.use(MOUNT_PATH, createChangeProposalRouter(crowi, { service }));
    app.use(NOTIFICATION_MOUNT_PATH, setupInAppNotificationRouter(crowi));
  }, 120_000);

  beforeEach(() => {
    currentUser = undefined;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    // Proposals made through the service are not tracked by the kit.
    const proposals = await prisma.changeproposals.findMany({
      where: { requester: users.requester._id.toString() },
      select: { id: true },
    });
    const ids = proposals.map((p) => p.id);
    await InAppNotification.deleteMany({ target: { $in: ids } });
    await prisma.activities.deleteMany({ where: { target: { in: ids } } });
    await prisma.changeproposals.deleteMany({ where: { id: { in: ids } } });
    await configManager.updateConfigs(
      { 'changeProposal:autoApplyPolicy': undefined },
      { removeIfUndefined: true },
    );
    await kit.tearDown();
  }, 60_000);

  it('lists exactly one summary notification for the subscriber of the edited page', async () => {
    const proposalId = await applyEditAndCreate();

    const listed = await listNotificationsOf(users.subscriber, proposalId);

    expect(listed).toHaveLength(1);
    expect(listed[0].action).toBe(SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY);
    const snapshot: ChangeProposalNotificationSnapshot = JSON.parse(
      listed[0].snapshot,
    );
    expect(snapshot.proposalId).toBe(proposalId);
  });

  it('lists the revert request with its message for the requester after the second user sends it', async () => {
    const proposalId = await applyEditAndCreate();
    const message = 'Please revert the edit <b>here</b>';

    asUser(users.subscriber);
    const sent = await request(app)
      .post(`${MOUNT_PATH}/${proposalId}/revert-request`)
      .set('X-Forwarded-For', TEST_IP)
      .send({ message });
    expect(sent.status).toBe(200);

    const requests = await vi.waitFor(
      async () => {
        const listed = (
          await listNotificationsOf(users.requester, proposalId)
        ).filter(
          (doc) =>
            doc.action ===
            SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT_REQUEST,
        );
        if (listed.length === 0) {
          throw new Error('the revert request is not listed yet');
        }
        return listed;
      },
      { timeout: 5000, interval: 100 },
    );
    expect(requests).toHaveLength(1);
    const snapshot: ChangeProposalRevertRequestSnapshot = JSON.parse(
      requests[0].snapshot,
    );
    expect(snapshot).toMatchObject({
      proposalId,
      kind: 'revert-request',
      message,
    });
    expect(requests[0].actionUsers.map((u) => u.username)).toEqual([
      users.subscriber.username,
    ]);
  });
});
