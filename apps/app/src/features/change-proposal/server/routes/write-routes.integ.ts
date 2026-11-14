import { randomUUID } from 'node:crypto';
import type { IUserHasId } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import express from 'express';
import mongoose, { type HydratedDocument, Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { AccessToken } from '~/server/models/access-token';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument } from '~/server/models/page';
import { UserStatus } from '~/server/models/user/conts';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { prisma } from '~/utils/prisma';

import type { ChangeProposalDocument } from '../../interfaces';
import { createChangeProposalService } from '../services/change-proposal-service';
import { createApplierTestKit } from '../services/proposal-applier.test-kit';
import { createChangeProposalRouter } from '.';

const TEST_IP = '10.0.0.171';
const PREFIX = '/cp-write-routes-integ';
const MOUNT_PATH = '/_api/v3/change-proposals';
const BACKGROUND = { kind: 'background' } as const;
// Long enough for the fire-and-forget activity writes to land if they were going to.
const ABSENCE_WAIT_MS = 500;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('change-proposal write routes', () => {
  let crowi: Crowi;
  let app: express.Application;
  let currentUser: IUserHasId | undefined;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpWriteRoutesRequester',
      subscriber: 'cpWriteRoutesViewer',
      other: 'cpWriteRoutesOther',
    },
  });
  const { users } = kit;
  const READ_ONLY_USERNAME = 'cpWriteRoutesReadOnly';
  let readOnlyUser: HydratedDocument<IUserHasId>;
  let pageWriteToken: string;
  let pageReadToken: string;
  const revertProposalIds: string[] = [];

  const asUser = (user: IUserHasId | undefined) => {
    currentUser = user;
  };

  const endpointOf = (id: string, action: string) =>
    `${MOUNT_PATH}/${id}/${action}`;

  const post = (id: string, action: string, body: object = {}) =>
    request(app)
      .post(endpointOf(id, action))
      .set('X-Forwarded-For', TEST_IP)
      .send(body);

  const put = (id: string, action: string, body: object = {}) =>
    request(app)
      .put(endpointOf(id, action))
      .set('X-Forwarded-For', TEST_IP)
      .send(body);

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

  const pendingProposal = async (
    pages: readonly HydratedDocument<PageDocument>[],
  ): Promise<ChangeProposalDocument> =>
    kit.storeProposal(
      pages.map((page) => kit.editInput(page)),
      { approve: false },
    );

  const newPendingProposal = async (): Promise<ChangeProposalDocument> =>
    pendingProposal([await kit.createPage('page')]);

  const appliedProposal = async (): Promise<ChangeProposalDocument> => {
    const proposal = await kit.storeProposal([
      kit.editInput(await kit.createPage('applied'), 'applied body'),
    ]);
    await kit.newApplier().apply(proposal._id, BACKGROUND, { ip: TEST_IP });
    await kit.waitForPageOperationsToFinish();
    return kit.reload(proposal._id);
  };

  const settledProposal = async (): Promise<ChangeProposalDocument> => {
    const proposal = await appliedProposal();
    expect(proposal.lifecycle).toBe('settled');
    return proposal;
  };

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);

    readOnlyUser = await mongoose.model<IUserHasId>('User').create({
      name: READ_ONLY_USERNAME,
      username: READ_ONLY_USERNAME,
      email: `${READ_ONLY_USERNAME}@example.com`,
      status: UserStatus.STATUS_ACTIVE,
      readOnly: true,
    });

    const oneDayLater = new Date(Date.now() + 1000 * 60 * 60 * 24);
    pageWriteToken = (
      await AccessToken.generateToken(users.requester._id, oneDayLater, [
        SCOPE.WRITE.FEATURES.PAGE,
      ])
    ).token;
    pageReadToken = (
      await AccessToken.generateToken(users.requester._id, oneDayLater, [
        SCOPE.READ.FEATURES.PAGE,
      ])
    ).token;

    const responseHelpers: { response: Record<string, unknown> } = {
      response: {},
    };
    addCustomFunctionToResponse(responseHelpers);
    app = express();
    // Activity rows carry req.ip; the suite's rows are found and removed by TEST_IP.
    app.set('trust proxy', true);
    app.use(express.json());
    app.use((req: express.Request & { user?: IUserHasId }, res, next) => {
      Object.assign(res, responseHelpers.response);
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
  }, 120_000);

  beforeEach(() => {
    currentUser = undefined;
    kit.editingPageIds.clear();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await InAppNotification.deleteMany({
      target: { $in: revertProposalIds },
    });
    await prisma.changeproposals.deleteMany({
      where: { id: { in: revertProposalIds } },
    });
    await AccessToken.deleteAllTokensByUserId(users.requester._id);
    await mongoose.model('User').deleteMany({ username: READ_ONLY_USERNAME });
    await kit.tearDown();
  }, 60_000);

  describe('POST /:id/approve', () => {
    it('applies every pending operation and records one APPLY activity for the request', async () => {
      asUser(users.requester);
      const proposal = await newPendingProposal();

      const res = await post(proposal._id, 'approve');

      expect(res.status).toBe(200);
      expect(res.body.result.type).toBe('done');
      expect(res.body.result.results).toEqual([
        expect.objectContaining({ status: 'applied' }),
      ]);
      const endpoint = endpointOf(proposal._id, 'approve');
      const [row] = await waitForActivitiesAt(endpoint, 1);
      await sleep(ABSENCE_WAIT_MS);
      expect(await activitiesAt(endpoint)).toHaveLength(1);
      expect(row).toMatchObject({
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
        target: proposal._id,
        userId: users.requester._id.toString(),
      });
    });

    it('applies only the chosen page', async () => {
      asUser(users.requester);
      const proposal = await pendingProposal([
        await kit.createPage('chosen'),
        await kit.createPage('left'),
      ]);
      const [chosen, left] = proposal.operations;

      const res = await post(proposal._id, 'approve', {
        operationKeys: [chosen.key],
      });

      expect(res.status).toBe(200);
      const reloaded = await kit.reload(proposal._id);
      expect(kit.operationOf(reloaded, chosen.key).status).toBe('applied');
      expect(kit.operationOf(reloaded, left.key).status).toBe('pending');
    });

    it('records no activity when nothing could be applied (someone is editing the page)', async () => {
      asUser(users.requester);
      const page = await kit.createPage('being-edited');
      const proposal = await pendingProposal([page]);
      kit.editingPageIds.add(page._id.toString());

      const res = await post(proposal._id, 'approve');

      expect(res.status).toBe(200);
      expect(res.body.result.type).toBe('done');
      expect(res.body.result.results).toEqual([
        expect.objectContaining({
          status: 'pending',
          reason: 'page-being-edited',
        }),
      ]);
      await expectNoActivityAt(endpointOf(proposal._id, 'approve'));
    });

    it('leaves the APPLY activity to the run holding the lease', async () => {
      asUser(users.requester);
      const proposal = await newPendingProposal();
      const foreignToken = randomUUID();
      expect(
        await prisma.changeproposals.claimApplyLease(
          proposal._id,
          foreignToken,
          new Date(),
        ),
      ).toBe(true);

      const res = await post(proposal._id, 'approve');

      expect(res.status).toBe(200);
      expect(res.body.result).toEqual({ type: 'in-progress' });
      await expectNoActivityAt(endpointOf(proposal._id, 'approve'));

      await prisma.changeproposals.releaseApplyLease(
        proposal._id,
        foreignToken,
      );
      await kit.newApplier().apply(proposal._id, BACKGROUND, { ip: TEST_IP });
      const rows = await vi.waitFor(
        async () => {
          const found = await prisma.activities.findMany({
            where: { ip: TEST_IP, target: proposal._id },
          });
          if (found.length === 0) {
            throw new Error('no apply activity yet');
          }
          return found;
        },
        { timeout: 5000, interval: 50 },
      );
      expect(rows).toEqual([
        expect.objectContaining({
          action: SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY,
          userId: users.requester._id.toString(),
        }),
      ]);
    });

    // This test issues 4 concurrent requests through the real Express+Mongo+Prisma
    // stack; the default 5000ms test timeout (vitest.workspace.mts sets none for
    // app-integration) is tight for that under a busy CI runner (matrix divergence
    // observed on the same commit — see issue #12251). Neither of the two drivers
    // essential-test-patterns calls out for a timeout bump applies here (no loop
    // parameter to redesign away, no shared setupFiles hook to blame), so this is a
    // bare timeout increase on this one test rather than a redesign.
    it('answers a missing, malformed, someone else’s and someone else’s settled proposal with one identical 404', async () => {
      const othersPending = await newPendingProposal();
      const othersSettled = await settledProposal();
      asUser(users.subscriber);
      const ids = [
        new Types.ObjectId().toString(),
        'not-an-object-id',
        othersPending._id,
        othersSettled._id,
      ];

      const responses = await Promise.all(ids.map((id) => post(id, 'approve')));

      for (const res of responses) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual(responses[0].body);
      }
      expect(responses[0].body.errors[0].code).toBe('notfound');
      expect((await kit.reload(othersPending._id)).operations[0].status).toBe(
        'pending',
      );
      await expectOneUnsettledAttempt(endpointOf(othersPending._id, 'approve'));
    }, 15_000);

    it('answers the requester’s settled proposal with 409 not_open', async () => {
      asUser(users.requester);
      const proposal = await settledProposal();

      const res = await post(proposal._id, 'approve');

      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('not_open');
      await expectOneUnsettledAttempt(endpointOf(proposal._id, 'approve'));
    });

    it.each([
      ['an empty key list', { operationKeys: [] }],
      ['a non-array key list', { operationKeys: 'key' }],
      ['a non-string key', { operationKeys: [1] }],
      ['an object key', { operationKeys: [{ $ne: null }] }],
    ])('rejects %s with 400 and records the attempt', async (_label, body) => {
      asUser(users.requester);
      const proposal = await newPendingProposal();

      const res = await post(proposal._id, 'approve', body);

      expect(res.status).toBe(400);
      expect(res.body.result).toBeUndefined();
      expect((await kit.reload(proposal._id)).operations[0].status).toBe(
        'pending',
      );
      await expectOneUnsettledAttempt(endpointOf(proposal._id, 'approve'));
    });

    it('rejects a read-only user without recording an activity', async () => {
      const proposal = await kit.storeProposal(
        [kit.editInput(await kit.createPage('read-only'))],
        { approve: false, requester: readOnlyUser._id.toString() },
      );
      asUser(readOnlyUser);

      const res = await post(proposal._id, 'approve');

      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('validation_failed');
      expect((await kit.reload(proposal._id)).operations[0].status).toBe(
        'pending',
      );
      await expectNoActivityAt(endpointOf(proposal._id, 'approve'));
    });

    it('accepts a page-write token and rejects a page-read token and an anonymous caller', async () => {
      const proposal = await newPendingProposal();

      const anonymous = await post(proposal._id, 'approve');
      const readScope = await post(proposal._id, 'approve').set(
        'Authorization',
        `Bearer ${pageReadToken}`,
      );
      expect(anonymous.status).toBe(403);
      expect(readScope.status).toBe(403);
      await expectNoActivityAt(endpointOf(proposal._id, 'approve'));

      const writeScope = await post(proposal._id, 'approve').set(
        'Authorization',
        `Bearer ${pageWriteToken}`,
      );
      expect(writeScope.status).toBe(200);
      expect(writeScope.body.result.type).toBe('done');
    });
  });

  describe('POST /:id/skip', () => {
    it('skips the chosen operation, settles the proposal and records no activity', async () => {
      asUser(users.requester);
      const proposal = await newPendingProposal();
      const [op] = proposal.operations;

      const res = await post(proposal._id, 'skip', { operationKeys: [op.key] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
      const reloaded = await kit.reload(proposal._id);
      expect(kit.operationOf(reloaded, op.key)).toMatchObject({
        status: 'skipped',
        reason: 'skipped-by-requester',
      });
      expect(reloaded.lifecycle).toBe('settled');
      await expectNoActivityAt(endpointOf(proposal._id, 'skip'));
    });

    it.each([
      ['a missing key list', {}],
      ['an empty key list', { operationKeys: [] }],
      ['a non-string key', { operationKeys: [true] }],
    ])('rejects %s with 400', async (_label, body) => {
      asUser(users.requester);
      const proposal = await newPendingProposal();

      const res = await post(proposal._id, 'skip', body);

      expect(res.status).toBe(400);
      expect((await kit.reload(proposal._id)).operations[0].status).toBe(
        'pending',
      );
    });

    it('answers someone else’s proposal like a missing one, and a settled own proposal with 409', async () => {
      const proposal = await newPendingProposal();
      const settled = await settledProposal();
      const body = { operationKeys: [proposal.operations[0].key] };

      asUser(users.subscriber);
      const others = await post(proposal._id, 'skip', body);
      const othersSettled = await post(settled._id, 'skip', body);
      const missing = await post(new Types.ObjectId().toString(), 'skip', body);
      asUser(users.requester);
      const notOpen = await post(settled._id, 'skip', body);

      expect(others.status).toBe(404);
      expect(others.body).toEqual(missing.body);
      expect(othersSettled.body).toEqual(missing.body);
      expect(missing.body.errors[0].code).toBe('notfound');
      expect(notOpen.status).toBe(409);
      expect(notOpen.body.errors[0].code).toBe('not_open');
    });

    it('rejects a read-only user', async () => {
      const proposal = await kit.storeProposal(
        [kit.editInput(await kit.createPage('read-only-skip'))],
        { approve: false, requester: readOnlyUser._id.toString() },
      );
      asUser(readOnlyUser);

      const res = await post(proposal._id, 'skip', {
        operationKeys: [proposal.operations[0].key],
      });

      expect(res.status).toBe(400);
      expect((await kit.reload(proposal._id)).operations[0].status).toBe(
        'pending',
      );
    });
  });

  describe('POST /:id/discard', () => {
    it('discards the proposal and records no activity', async () => {
      asUser(users.requester);
      const proposal = await newPendingProposal();

      const res = await post(proposal._id, 'discard');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
      const reloaded = await kit.reload(proposal._id);
      expect(reloaded.lifecycle).toBe('discarded');
      expect(reloaded.operations[0]).toMatchObject({
        status: 'skipped',
        reason: 'discarded',
      });
      await expectNoActivityAt(endpointOf(proposal._id, 'discard'));
    });

    it('answers someone else’s proposal like a missing one, and a discarded one with 409', async () => {
      const proposal = await newPendingProposal();

      asUser(users.subscriber);
      const others = await post(proposal._id, 'discard');
      const missing = await post('not-an-object-id', 'discard');
      asUser(users.requester);
      const first = await post(proposal._id, 'discard');
      const again = await post(proposal._id, 'discard');

      expect(others.status).toBe(404);
      expect(others.body).toEqual(missing.body);
      expect(first.status).toBe(200);
      expect(again.status).toBe(409);
      expect(again.body.errors[0].code).toBe('not_open');
    });

    it('rejects a read-only user', async () => {
      const proposal = await kit.storeProposal(
        [kit.editInput(await kit.createPage('read-only-discard'))],
        { approve: false, requester: readOnlyUser._id.toString() },
      );
      asUser(readOnlyUser);

      const res = await post(proposal._id, 'discard');

      expect(res.status).toBe(400);
      expect((await kit.reload(proposal._id)).lifecycle).toBe('open');
    });
  });

  describe('PUT /:id/per-page-notifications', () => {
    it('changes the requester’s switch and records no activity', async () => {
      asUser(users.requester);
      const proposal = await kit.storeProposal(
        [kit.editInput(await kit.createPage('switch'))],
        { approve: false, perPageNotifications: true },
      );

      const res = await put(proposal._id, 'per-page-notifications', {
        enabled: false,
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
      expect((await kit.reload(proposal._id)).perPageNotifications).toBe(false);
      await expectNoActivityAt(
        endpointOf(proposal._id, 'per-page-notifications'),
      );
    });

    it.each([
      ['a missing value', {}],
      ['a string', { enabled: 'true' }],
      ['a number', { enabled: 1 }],
      ['null', { enabled: null }],
    ])('rejects %s with 400', async (_label, body) => {
      asUser(users.requester);
      const proposal = await kit.storeProposal(
        [kit.editInput(await kit.createPage('switch-invalid'))],
        { approve: false, perPageNotifications: true },
      );

      const res = await put(proposal._id, 'per-page-notifications', body);

      expect(res.status).toBe(400);
      expect((await kit.reload(proposal._id)).perPageNotifications).toBe(true);
    });

    it('answers someone else’s proposal like a missing one, and a settled own proposal with 409', async () => {
      const proposal = await newPendingProposal();
      const settled = await settledProposal();
      const body = { enabled: true };

      asUser(users.subscriber);
      const others = await put(proposal._id, 'per-page-notifications', body);
      const missing = await put(
        new Types.ObjectId().toString(),
        'per-page-notifications',
        body,
      );
      asUser(users.requester);
      const notOpen = await put(settled._id, 'per-page-notifications', body);

      expect(others.status).toBe(404);
      expect(others.body).toEqual(missing.body);
      expect(notOpen.status).toBe(409);
      expect(notOpen.body.errors[0].code).toBe('not_open');
    });

    it('rejects a read-only user', async () => {
      const proposal = await kit.storeProposal(
        [kit.editInput(await kit.createPage('read-only-switch'))],
        {
          approve: false,
          requester: readOnlyUser._id.toString(),
          perPageNotifications: true,
        },
      );
      asUser(readOnlyUser);

      const res = await put(proposal._id, 'per-page-notifications', {
        enabled: false,
      });

      expect(res.status).toBe(400);
      expect((await kit.reload(proposal._id)).perPageNotifications).toBe(true);
    });
  });

  describe('POST /:id/revert', () => {
    it('reverts every visible applied operation and records one REVERT activity on the revert proposal', async () => {
      const proposal = await appliedProposal();
      asUser(users.subscriber);

      const res = await post(proposal._id, 'revert');

      expect(res.status).toBe(200);
      const { revertProposalId, operations } = res.body.result;
      expect(typeof revertProposalId).toBe('string');
      revertProposalIds.push(revertProposalId);
      expect(operations).toEqual([
        { key: proposal.operations[0].key, outcome: 'reverted' },
      ]);
      const endpoint = endpointOf(proposal._id, 'revert');
      const [row] = await waitForActivitiesAt(endpoint, 1);
      await sleep(ABSENCE_WAIT_MS);
      expect(await activitiesAt(endpoint)).toHaveLength(1);
      expect(row).toMatchObject({
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT,
        target: revertProposalId,
        userId: users.subscriber._id.toString(),
      });
    });

    it('creates nothing and records no activity when no chosen operation can be reverted', async () => {
      const proposal = await appliedProposal();
      asUser(users.requester);

      const res = await post(proposal._id, 'revert', {
        operationKeys: [randomUUID()],
      });

      expect(res.status).toBe(200);
      expect(res.body.result).toEqual({ operations: [] });
      await expectNoActivityAt(endpointOf(proposal._id, 'revert'));
    });

    it('answers a missing, malformed and nothing-visible proposal with one identical 404', async () => {
      const pending = await newPendingProposal();
      asUser(users.subscriber);
      const ids = [
        new Types.ObjectId().toString(),
        'not-an-object-id',
        pending._id,
      ];

      const responses = await Promise.all(ids.map((id) => post(id, 'revert')));

      for (const res of responses) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual(responses[0].body);
      }
      expect(responses[0].body.errors[0].code).toBe('notfound');
    });

    it.each([
      ['an empty key list', { operationKeys: [] }],
      ['a non-array key list', { operationKeys: { key: 'x' } }],
      ['a non-string key', { operationKeys: [null] }],
    ])('rejects %s with 400', async (_label, body) => {
      asUser(users.requester);
      const proposal = await appliedProposal();

      const res = await post(proposal._id, 'revert', body);

      expect(res.status).toBe(400);
      expect((await kit.reload(proposal._id)).operations[0].status).toBe(
        'applied',
      );
    });

    it('rejects a read-only user without recording an activity', async () => {
      const proposal = await appliedProposal();
      asUser(readOnlyUser);

      const res = await post(proposal._id, 'revert');

      expect(res.status).toBe(400);
      expect((await kit.reload(proposal._id)).operations[0].status).toBe(
        'applied',
      );
      await expectNoActivityAt(endpointOf(proposal._id, 'revert'));
    });
  });
});
