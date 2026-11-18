import type { IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
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
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import {
  type ChangeProposalDocument,
  MAX_REVIEW_COMMENT_LENGTH,
  MAX_REVIEWERS,
  type ReviewerInput,
  type ReviewerRef,
} from '../../interfaces';
import { createChangeProposalService } from '../services/change-proposal-service';
import { createApplierTestKit } from '../services/proposal-applier.test-kit';
import { createChangeProposalRouter } from '.';
import { MAX_OPERATION_KEYS } from './write-access';

const TEST_IP = '10.0.0.181';
const PREFIX = '/cp-reviewer-routes-integ';
const MOUNT_PATH = '/_api/v3/change-proposals';
const BACKGROUND = { kind: 'background' } as const;
// Long enough for the fire-and-forget activity writes to land if they were going to.
const ABSENCE_WAIT_MS = 500;
// Stands for any reviewer in a body that is refused before the reviewer is looked at.
const SOMEONE = { kind: 'user', id: '0'.repeat(24) };

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe('change-proposal reviewer routes', () => {
  let crowi: Crowi;
  let app: express.Application;
  let currentUser: IUserHasId | undefined;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix: PREFIX,
    ip: TEST_IP,
    usernames: {
      requester: 'cpReviewerRoutesRequester',
      subscriber: 'cpReviewerRoutesReviewer',
      other: 'cpReviewerRoutesStranger',
    },
  });
  const { users } = kit;
  const EXTRA_USERNAMES = {
    readOnly: 'cpReviewerRoutesReadOnly',
    added: 'cpReviewerRoutesAdded',
  };
  let readOnlyUser: HydratedDocument<IUserHasId>;
  let addedUser: HydratedDocument<IUserHasId>;
  let reviewerWriteToken: string;
  let reviewerReadToken: string;

  const asUser = (user: IUserHasId | undefined) => {
    currentUser = user;
  };

  const idOf = (user: IUserHasId): string => user._id.toString();

  const endpointOf = (id: string, action: string) =>
    `${MOUNT_PATH}/${id}/${action}`;

  const postReview = (id: string, body: object) =>
    request(app)
      .post(endpointOf(id, 'reviews'))
      .set('X-Forwarded-For', TEST_IP)
      .send(body);

  const patchReviewers = (id: string, body: object) =>
    request(app)
      .patch(endpointOf(id, 'reviewers'))
      .set('X-Forwarded-For', TEST_IP)
      .send(body);

  const getQueue = (query: Record<string, string> = {}) =>
    request(app).get(`${MOUNT_PATH}/review-queue`).query(query);

  const bearer = (token: string) => `Bearer ${token}`;

  const activitiesAt = (endpoint: string) =>
    prisma.activities.findMany({ where: { ip: TEST_IP, endpoint } });

  // The settled row of a request, once no further row shows up for it.
  const onlyActivityAt = async (endpoint: string) => {
    const rows = await vi.waitFor(
      async () => {
        const found = await activitiesAt(endpoint);
        if (found.length === 0) {
          throw new Error(`no activity at ${endpoint}`);
        }
        return found;
      },
      { timeout: 5000, interval: 50 },
    );
    await sleep(ABSENCE_WAIT_MS);
    expect(await activitiesAt(endpoint)).toHaveLength(1);
    return rows[0];
  };

  const expectNoActivityAt = async (endpoint: string) => {
    await sleep(ABSENCE_WAIT_MS);
    expect(await activitiesAt(endpoint)).toEqual([]);
  };

  const expectOneUnsettledAttempt = async (endpoint: string) => {
    const row = await onlyActivityAt(endpoint);
    expect(row.action).toBe(SupportedAction.ACTION_UNSETTLED);
  };

  const userInput = (user: IUserHasId): ReviewerInput => ({
    kind: 'user',
    id: idOf(user),
  });

  const storedRef = (input: ReviewerInput): ReviewerRef => ({
    ...input,
    addedBy: idOf(users.requester),
    addedAt: new Date(),
  });

  // users.subscriber is the reviewer of every proposal these helpers store.
  const reviewedProposal = async (
    pages?: readonly HydratedDocument<PageDocument>[],
    options: { readonly approve?: boolean; readonly requester?: string } = {},
  ): Promise<ChangeProposalDocument> =>
    kit.storeProposal(
      (pages ?? [await kit.createPage('page')]).map((page) =>
        kit.editInput(page),
      ),
      {
        approve: false,
        reviewers: [storedRef(userInput(users.subscriber))],
        ...options,
      },
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

  // Applied, so the reviewer still sees its operation but nothing is left to decide.
  const settledReviewedProposal = async (): Promise<ChangeProposalDocument> => {
    const proposal = await reviewedProposal(undefined, { approve: true });
    await kit.newApplier().apply(proposal._id, BACKGROUND, { ip: TEST_IP });
    await kit.waitForPageOperationsToFinish();
    return kit.reload(proposal._id);
  };

  const activeReviewerIdsOf = async (proposalId: string) =>
    (await kit.reload(proposalId)).reviewers
      .filter((r) => r.removedAt == null)
      .map((r) => r.id)
      .sort();

  const setReviewersEnabled = (enabled: boolean) =>
    configManager.updateConfigs({
      'app:changeProposalReviewersEnabled': enabled,
    });

  beforeAll(async () => {
    crowi = await getInstance();
    await kit.setUp();
    vi.spyOn(crowi.pageService.pageEvent, 'emit').mockReturnValue(true);

    const User = mongoose.model<IUserHasId>('User');
    const createUser = (username: string, readOnly: boolean) =>
      User.create({
        name: username,
        username,
        email: `${username}@example.com`,
        status: UserStatus.STATUS_ACTIVE,
        readOnly,
      });
    readOnlyUser = await createUser(EXTRA_USERNAMES.readOnly, true);
    addedUser = await createUser(EXTRA_USERNAMES.added, false);

    const oneDayLater = new Date(Date.now() + 1000 * 60 * 60 * 24);
    reviewerWriteToken = (
      await AccessToken.generateToken(users.subscriber._id, oneDayLater, [
        SCOPE.WRITE.FEATURES.PAGE,
      ])
    ).token;
    reviewerReadToken = (
      await AccessToken.generateToken(users.subscriber._id, oneDayLater, [
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

  beforeEach(async () => {
    currentUser = undefined;
    await setReviewersEnabled(true);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await configManager.updateConfigs(
      { 'app:changeProposalReviewersEnabled': undefined },
      { removeIfUndefined: true },
    );
    const extraIds = [readOnlyUser._id, addedUser._id];
    await InAppNotification.deleteMany({ user: { $in: extraIds } });
    await AccessToken.deleteAllTokensByUserId(users.subscriber._id);
    await mongoose.model('User').deleteMany({ _id: { $in: extraIds } });
    await kit.tearDown();
  }, 60_000);

  describe('POST /:id/reviews', () => {
    it('records a rejection of the chosen operation without changing its state, and the activity keeps the reviewer (Reviewers Req 3.1, 6.8)', async () => {
      const proposal = await reviewedProposal();
      const [op] = proposal.operations;
      asUser(users.subscriber);

      const res = await postReview(proposal._id, {
        kind: 'reject',
        operationKeys: [op.key],
        comment: 'please split this change',
      });

      expect(res.status).toBe(200);
      expect(res.body.result).toEqual({
        type: 'done',
        results: [{ key: op.key, status: 'pending', reason: null }],
      });
      expect((await kit.reload(proposal._id)).reviews).toEqual([
        expect.objectContaining({
          kind: 'reject',
          operationKey: op.key,
          by: idOf(users.subscriber),
          comment: 'please split this change',
          channel: 'ui',
        }),
      ]);
      const row = await onlyActivityAt(endpointOf(proposal._id, 'reviews'));
      expect(row).toMatchObject({
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REJECT,
        target: proposal._id,
        userId: idOf(users.subscriber),
      });
      expect(row.snapshot).toMatchObject({
        username: users.subscriber.username,
        reviewChannel: 'ui',
      });
    });

    it('records a rejection of the whole proposal when no keys are given, treating an empty comment as none (Reviewers Req 3.2)', async () => {
      const proposal = await reviewedProposal();
      asUser(users.subscriber);

      const res = await postReview(proposal._id, {
        kind: 'reject',
        comment: '',
      });

      expect(res.status).toBe(200);
      expect(res.body.result).toEqual({ type: 'done', results: [] });
      const [review, ...rest] = (await kit.reload(proposal._id)).reviews;
      expect(rest).toEqual([]);
      expect(review).toMatchObject({
        kind: 'reject',
        by: idOf(users.subscriber),
      });
      expect([review.operationKey ?? null, review.comment ?? null]).toEqual([
        null,
        null,
      ]);
      const row = await onlyActivityAt(endpointOf(proposal._id, 'reviews'));
      expect(row).toMatchObject({
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REJECT,
        userId: idOf(users.subscriber),
      });
    });

    it('records an abstention of the chosen operation, and the activity keeps the reviewer (Reviewers Req 3.3, 6.8)', async () => {
      const proposal = await reviewedProposal();
      const [op] = proposal.operations;
      asUser(users.subscriber);

      const res = await postReview(proposal._id, {
        kind: 'abstain',
        operationKeys: [op.key],
      });

      expect(res.status).toBe(200);
      expect(res.body.result).toEqual({
        type: 'done',
        results: [{ key: op.key, status: 'pending', reason: null }],
      });
      expect((await kit.reload(proposal._id)).reviews).toEqual([
        expect.objectContaining({ kind: 'abstain', operationKey: op.key }),
      ]);
      const row = await onlyActivityAt(endpointOf(proposal._id, 'reviews'));
      expect(row).toMatchObject({
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_ABSTAIN,
        userId: idOf(users.subscriber),
      });
      expect(row.snapshot).toMatchObject({
        username: users.subscriber.username,
        reviewChannel: 'ui',
      });
    });

    it('marks a review sent with an access token as coming from the API (Reviewers Req 6.8)', async () => {
      const proposal = await reviewedProposal();

      const readScope = await postReview(proposal._id, {
        kind: 'reject',
      }).set('Authorization', bearer(reviewerReadToken));
      const writeScope = await postReview(proposal._id, {
        kind: 'abstain',
        operationKeys: [proposal.operations[0].key],
      }).set('Authorization', bearer(reviewerWriteToken));

      expect(readScope.status).toBe(403);
      expect(writeScope.status).toBe(200);
      expect((await kit.reload(proposal._id)).reviews).toEqual([
        expect.objectContaining({ kind: 'abstain', channel: 'api' }),
      ]);
      const row = await onlyActivityAt(endpointOf(proposal._id, 'reviews'));
      expect(row.snapshot).toMatchObject({ reviewChannel: 'api' });
    });

    it.each([
      [
        'a rejection with an empty key list',
        { kind: 'reject', operationKeys: [] },
      ],
      ['an abstention without keys', { kind: 'abstain' }],
      [
        'an abstention with an empty key list',
        { kind: 'abstain', operationKeys: [] },
      ],
      ['a non-array key list', { kind: 'reject', operationKeys: 'key' }],
      ['a null key list', { kind: 'reject', operationKeys: null }],
      ['a non-string key', { kind: 'reject', operationKeys: [{ $ne: null }] }],
      [
        'more keys than one request may carry',
        {
          kind: 'reject',
          operationKeys: Array.from(
            { length: MAX_OPERATION_KEYS + 1 },
            (_, i) => `k${i}`,
          ),
        },
      ],
      ['a non-string comment', { kind: 'reject', comment: { $ne: null } }],
      ['an unknown kind', { kind: 'approve' }],
      ['no kind', {}],
    ])('answers %s with 400 invalid_request and records nothing but the attempt', async (_label, body) => {
      const proposal = await reviewedProposal();
      asUser(users.subscriber);

      const res = await postReview(proposal._id, body);

      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('invalid_request');
      expect((await kit.reload(proposal._id)).reviews).toEqual([]);
      await expectOneUnsettledAttempt(endpointOf(proposal._id, 'reviews'));
    });

    it('answers a comment over the limit with 400 comment_too_long (Reviewers Req 3.6)', async () => {
      const proposal = await reviewedProposal();
      asUser(users.subscriber);

      const res = await postReview(proposal._id, {
        kind: 'reject',
        comment: 'x'.repeat(MAX_REVIEW_COMMENT_LENGTH + 1),
      });

      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('comment_too_long');
      expect((await kit.reload(proposal._id)).reviews).toEqual([]);
    });

    it('answers the requester with 400 requester_cannot_review (Reviewers Req 3.10)', async () => {
      const proposal = await reviewedProposal();
      asUser(users.requester);

      const responses = [
        await postReview(proposal._id, { kind: 'reject' }),
        await postReview(proposal._id, {
          kind: 'abstain',
          operationKeys: [proposal.operations[0].key],
        }),
      ];

      for (const res of responses) {
        expect(res.status).toBe(400);
        expect(res.body.errors[0].code).toBe('requester_cannot_review');
      }
      expect((await kit.reload(proposal._id)).reviews).toEqual([]);
    });

    it('answers a missing proposal, a stranger and a reviewer who sees none of its pages with one identical 404 (Reviewers Req 2.7, 3.11)', async () => {
      const proposal = await reviewedProposal();
      const hidden = await reviewedProposal([
        await requesterOnlyPage('hidden'),
      ]);
      const body = { kind: 'reject' };

      asUser(users.subscriber);
      const missing = await postReview(new Types.ObjectId().toString(), body);
      const nothingVisible = await postReview(hidden._id, body);
      asUser(users.other);
      const stranger = await postReview(proposal._id, body);

      for (const res of [missing, nothingVisible, stranger]) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual(missing.body);
      }
      expect(missing.body.errors[0].code).toBe('notfound');
      expect((await kit.reload(hidden._id)).reviews).toEqual([]);
      expect((await kit.reload(proposal._id)).reviews).toEqual([]);
    });

    it('answers a reviewer with nothing left to decide with 409 not_open (Reviewers Req 2.9)', async () => {
      const proposal = await settledReviewedProposal();
      asUser(users.subscriber);

      const res = await postReview(proposal._id, { kind: 'reject' });

      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('not_open');
      expect((await kit.reload(proposal._id)).reviews).toEqual([]);
    });

    it('refuses a read-only reviewer and a guest without recording an activity (Reviewers Req 7.5)', async () => {
      const proposal = await kit.storeProposal(
        [kit.editInput(await kit.createPage('read-only'))],
        { approve: false, reviewers: [storedRef(userInput(readOnlyUser))] },
      );
      const body = { kind: 'reject' };

      const guest = await postReview(proposal._id, body);
      asUser(readOnlyUser);
      const readOnly = await postReview(proposal._id, body);

      expect(guest.status).toBe(403);
      expect(readOnly.status).toBe(400);
      expect(readOnly.body.errors[0].code).toBe('validation_failed');
      expect((await kit.reload(proposal._id)).reviews).toEqual([]);
      await expectNoActivityAt(endpointOf(proposal._id, 'reviews'));
    });
  });

  describe('PATCH /:id/reviewers', () => {
    it('adds the reviewers with 204, and the activity keeps the one who added them (Reviewers Req 4.1, 6.10)', async () => {
      const proposal = await reviewedProposal();
      asUser(users.subscriber);

      const res = await patchReviewers(proposal._id, {
        add: [userInput(addedUser)],
      });

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
      expect(await activeReviewerIdsOf(proposal._id)).toEqual(
        [idOf(users.subscriber), idOf(addedUser)].sort(),
      );
      const row = await onlyActivityAt(endpointOf(proposal._id, 'reviewers'));
      expect(row).toMatchObject({
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEWER_ADD,
        target: proposal._id,
        userId: idOf(users.subscriber),
      });
      expect(row.snapshot).toMatchObject({
        username: users.subscriber.username,
        reviewChannel: 'ui',
      });
    });

    it('removes the reviewers with 204, and the activity keeps the one who removed them (Reviewers Req 4.3, 6.10)', async () => {
      const proposal = await reviewedProposal();
      asUser(users.requester);

      const res = await patchReviewers(proposal._id, {
        remove: [userInput(users.subscriber)],
      });

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
      expect(await activeReviewerIdsOf(proposal._id)).toEqual([]);
      const row = await onlyActivityAt(endpointOf(proposal._id, 'reviewers'));
      expect(row).toMatchObject({
        action: SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEWER_REMOVE,
        target: proposal._id,
        userId: idOf(users.requester),
      });
      expect(row.snapshot).toMatchObject({
        username: users.requester.username,
        reviewChannel: 'ui',
      });
    });

    it('marks an addition and a removal sent with an access token as coming from the API (Reviewers Req 6.10)', async () => {
      const added = await reviewedProposal();
      const removed = await reviewedProposal();

      const readScope = await patchReviewers(added._id, {
        add: [userInput(addedUser)],
      }).set('Authorization', bearer(reviewerReadToken));
      const addition = await patchReviewers(added._id, {
        add: [userInput(addedUser)],
      }).set('Authorization', bearer(reviewerWriteToken));
      const removal = await patchReviewers(removed._id, {
        remove: [userInput(users.subscriber)],
      }).set('Authorization', bearer(reviewerWriteToken));

      expect([readScope.status, addition.status, removal.status]).toEqual([
        403, 204, 204,
      ]);
      const rows = [
        await onlyActivityAt(endpointOf(added._id, 'reviewers')),
        await onlyActivityAt(endpointOf(removed._id, 'reviewers')),
      ];
      expect(
        rows.map((row) => [row.action, row.snapshot?.reviewChannel]),
      ).toEqual([
        [SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEWER_ADD, 'api'],
        [SupportedAction.ACTION_CHANGE_PROPOSAL_REVIEWER_REMOVE, 'api'],
      ]);
    });

    it.each([
      ['both add and remove', { add: [SOMEONE], remove: [SOMEONE] }],
      ['neither add nor remove', {}],
      ['an empty add', { add: [] }],
      ['an empty remove', { remove: [] }],
      ['a non-array add', { add: SOMEONE }],
      ['a reviewer of an unknown kind', { add: [{ ...SOMEONE, kind: 'all' }] }],
    ])('answers %s with 400 invalid_request and changes nothing', async (_label, body) => {
      const proposal = await reviewedProposal();
      asUser(users.requester);

      const res = await patchReviewers(proposal._id, body);

      expect(res.status).toBe(400);
      expect(res.body.errors[0].code).toBe('invalid_request');
      expect(await activeReviewerIdsOf(proposal._id)).toEqual([
        idOf(users.subscriber),
      ]);
      await expectOneUnsettledAttempt(endpointOf(proposal._id, 'reviewers'));
    });

    it('answers an addition it cannot store with 400 and the reason (Reviewers Req 4.5, 4.9)', async () => {
      const proposal = await reviewedProposal();
      const unknownUser = { kind: 'user', id: new Types.ObjectId().toString() };
      const tooMany = Array.from({ length: MAX_REVIEWERS }, () => ({
        kind: 'user',
        id: new Types.ObjectId().toString(),
      }));
      asUser(users.requester);

      const notFound = await patchReviewers(proposal._id, {
        add: [unknownUser],
      });
      const overLimit = await patchReviewers(proposal._id, { add: tooMany });
      await setReviewersEnabled(false);
      const disabled = await patchReviewers(proposal._id, {
        add: [userInput(addedUser)],
      });

      expect(
        [notFound, overLimit, disabled].map((res) => [
          res.status,
          res.body.errors[0].code,
        ]),
      ).toEqual([
        [400, 'reviewer_not_found'],
        [400, 'too_many_reviewers'],
        [400, 'reviewers_disabled'],
      ]);
      expect(await activeReviewerIdsOf(proposal._id)).toEqual([
        idOf(users.subscriber),
      ]);
    });

    it('answers a missing proposal, a stranger and a reviewer who sees none of its pages with one identical 404 (Reviewers Req 2.7)', async () => {
      const proposal = await reviewedProposal();
      const hidden = await reviewedProposal([
        await requesterOnlyPage('hidden'),
      ]);
      const body = { add: [userInput(addedUser)] };

      asUser(users.subscriber);
      const missing = await patchReviewers(
        new Types.ObjectId().toString(),
        body,
      );
      const nothingVisible = await patchReviewers(hidden._id, body);
      asUser(users.other);
      const stranger = await patchReviewers(proposal._id, body);

      for (const res of [missing, nothingVisible, stranger]) {
        expect(res.status).toBe(404);
        expect(res.body).toEqual(missing.body);
      }
      expect(missing.body.errors[0].code).toBe('notfound');
      expect(await activeReviewerIdsOf(hidden._id)).toEqual([
        idOf(users.subscriber),
      ]);
      expect(await activeReviewerIdsOf(proposal._id)).toEqual([
        idOf(users.subscriber),
      ]);
    });

    it('answers a proposal that is no longer open with 409 not_open (Reviewers Req 4.8)', async () => {
      const proposal = await settledReviewedProposal();
      asUser(users.requester);

      const res = await patchReviewers(proposal._id, {
        remove: [userInput(users.subscriber)],
      });

      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('not_open');
      expect(await activeReviewerIdsOf(proposal._id)).toEqual([
        idOf(users.subscriber),
      ]);
    });

    it('refuses a read-only requester and a guest without recording an activity (Reviewers Req 7.5)', async () => {
      const proposal = await reviewedProposal(undefined, {
        requester: idOf(readOnlyUser),
      });
      const body = { remove: [userInput(users.subscriber)] };

      const guest = await patchReviewers(proposal._id, body);
      asUser(readOnlyUser);
      const readOnly = await patchReviewers(proposal._id, body);

      expect(guest.status).toBe(403);
      expect(readOnly.status).toBe(400);
      expect(readOnly.body.errors[0].code).toBe('validation_failed');
      expect(await activeReviewerIdsOf(proposal._id)).toEqual([
        idOf(users.subscriber),
      ]);
      await expectNoActivityAt(endpointOf(proposal._id, 'reviewers'));
    });
  });

  describe('GET /review-queue', () => {
    // Other tests leave open proposals in the reviewer's queue, so each test follows the cursor to its own.
    const queuedIdsFrom = async (cursor: string | null): Promise<string[]> => {
      const res = await getQueue(cursor == null ? {} : { cursor });
      expect(res.status).toBe(200);
      const ids: string[] = res.body.items.map(
        (item: { id: string }) => item.id,
      );
      return res.body.nextCursor == null
        ? ids
        : [...ids, ...(await queuedIdsFrom(res.body.nextCursor))];
    };

    it('lists the proposals waiting for the caller as a reviewer instead of looking up a proposal by that id (Reviewers Req 5.5)', async () => {
      const mine = await reviewedProposal();
      const notMine = await kit.storeProposal(
        [kit.editInput(await kit.createPage('not-mine'))],
        { approve: false, reviewers: [storedRef(userInput(addedUser))] },
      );
      asUser(users.subscriber);

      const res = await getQueue({ limit: '50' });

      expect(res.status).toBe(200);
      expect(res.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: mine._id, viewerRole: 'reviewer' }),
        ]),
      );
      const ids = await queuedIdsFrom(null);
      expect(ids).toContain(mine._id);
      expect(ids).not.toContain(notMine._id);
    });

    it('continues after the cursor, oldest first (Reviewers Req 5.5)', async () => {
      const older = await reviewedProposal();
      const newer = await reviewedProposal();
      asUser(users.subscriber);

      const first = await getQueue({ limit: '1' });
      const all = await queuedIdsFrom(null);
      const afterOlder = await getQueue({ cursor: older._id, limit: '1' });

      expect(first.status).toBe(200);
      expect(first.body.items).toHaveLength(1);
      expect(first.body.nextCursor).toBe(first.body.items[0].id);
      expect(all.indexOf(older._id)).toBeLessThan(all.indexOf(newer._id));
      expect(afterOlder.body.items.map((i: { id: string }) => i.id)).toEqual([
        newer._id,
      ]);
    });

    it('lists only the pages the caller may view (Reviewers Req 5.6)', async () => {
      const visiblePage = await kit.createPage('visible');
      const hiddenPage = await requesterOnlyPage('hidden');
      const proposal = await reviewedProposal([visiblePage, hiddenPage]);
      asUser(users.subscriber);

      const res = await getQueue({ limit: '50' });

      const item = res.body.items.find(
        (i: { id: string }) => i.id === proposal._id,
      );
      expect(item.pages).toEqual([
        { id: visiblePage._id.toString(), path: visiblePage.path },
      ]);
      expect(JSON.stringify(res.body)).not.toContain(hiddenPage.path);
    });

    it.each([
      ['a malformed cursor', { cursor: 'not-an-object-id' }],
      ['an uppercase cursor', { cursor: 'AAAAAAAAAAAAAAAAAAAAAAAA' }],
      ['a zero limit', { limit: '0' }],
      ['a limit over the maximum', { limit: '51' }],
      ['a non-numeric limit', { limit: 'many' }],
    ])('answers %s with 400', async (_label, query) => {
      asUser(users.subscriber);

      const res = await getQueue(query);

      expect(res.status).toBe(400);
      expect(res.body.items).toBeUndefined();
    });

    it('refuses a guest, and serves a read-only user and a page-read token like the other lists', async () => {
      const proposal = await reviewedProposal();
      const forReadOnly = await kit.storeProposal(
        [kit.editInput(await kit.createPage('for-read-only'))],
        { approve: false, reviewers: [storedRef(userInput(readOnlyUser))] },
      );
      const idsOf = (res: { body: { items: { id: string }[] } }) =>
        res.body.items.map((item) => item.id);

      const guest = await getQueue();
      const readScope = await getQueue({ limit: '50' }).set(
        'Authorization',
        bearer(reviewerReadToken),
      );
      asUser(readOnlyUser);
      const readOnly = await getQueue({ limit: '50' });

      expect(guest.status).toBe(403);
      expect(readScope.status).toBe(200);
      expect(idsOf(readScope)).toContain(proposal._id);
      expect(readOnly.status).toBe(200);
      expect(idsOf(readOnly)).toContain(forReadOnly._id);
      expect(idsOf(readOnly)).not.toContain(proposal._id);
    });
  });
});
