import type { IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import express from 'express';
import mongoose, { type HydratedDocument } from 'mongoose';
import request from 'supertest';

import { SupportedAction } from '~/interfaces/activity';
import type Crowi from '~/server/crowi';
import { AccessToken } from '~/server/models/access-token';
import { InAppNotification } from '~/server/models/in-app-notification';
import type { PageDocument } from '~/server/models/page';
import { UserStatus } from '~/server/models/user/conts';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type {
  ChangeProposalDocument,
  ReviewerInput,
  ReviewerRef,
} from '../../interfaces';
import {
  type ChangeProposalService,
  createChangeProposalService,
} from '../services/change-proposal-service';
import { createApplierTestKit } from '../services/proposal-applier.test-kit';
import { createChangeProposalRouter } from '.';

const MOUNT_PATH = '/_api/v3/change-proposals';
const BACKGROUND = { kind: 'background' } as const;
// Long enough for the fire-and-forget activity writes to land if they were going to.
const ABSENCE_WAIT_MS = 500;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// Registers the hooks that mount the change-proposal router over a real Crowi,
// and returns the helpers the reviewer route suites drive it with. Every suite
// needs its own prefix, ip and username base so parallel workers never share rows.
export const createReviewerRoutesTestKit = (args: {
  // Passed in: this file is part of the server build, which cannot reach test/setup.
  readonly loadCrowi: () => Promise<Crowi>;
  readonly prefix: string;
  readonly ip: string;
  readonly usernameBase: string;
}) => {
  const { loadCrowi, prefix, ip, usernameBase } = args;
  let crowi: Crowi;
  let app: express.Application;
  let service: ChangeProposalService;
  let currentUser: IUserHasId | undefined;
  const kit = createApplierTestKit({
    getCrowi: () => crowi,
    prefix,
    ip,
    usernames: {
      requester: `${usernameBase}Requester`,
      subscriber: `${usernameBase}Reviewer`,
      other: `${usernameBase}Stranger`,
    },
  });
  const { users } = kit;
  const extraUsernames = {
    readOnly: `${usernameBase}ReadOnly`,
    added: `${usernameBase}Added`,
  };
  // Filled in beforeAll; read them inside tests, not at collection time.
  const fixtures = {} as {
    readOnlyUser: HydratedDocument<IUserHasId>;
    addedUser: HydratedDocument<IUserHasId>;
    reviewerWriteToken: string;
    reviewerReadToken: string;
  };

  const asUser = (user: IUserHasId | undefined) => {
    currentUser = user;
  };

  const idOf = (user: IUserHasId): string => user._id.toString();

  const endpointOf = (id: string, action: string) =>
    `${MOUNT_PATH}/${id}/${action}`;

  const postReview = (id: string, body: object) =>
    request(app)
      .post(endpointOf(id, 'reviews'))
      .set('X-Forwarded-For', ip)
      .send(body);

  const patchReviewers = (id: string, body: object) =>
    request(app)
      .patch(endpointOf(id, 'reviewers'))
      .set('X-Forwarded-For', ip)
      .send(body);

  const getProposal = (id: string) => request(app).get(`${MOUNT_PATH}/${id}`);

  const postAction = (
    id: string,
    action: 'approve' | 'skip' | 'discard',
    body: object = {},
  ) =>
    request(app)
      .post(endpointOf(id, action))
      .set('X-Forwarded-For', ip)
      .send(body);

  const putPerPageNotifications = (id: string, enabled: boolean) =>
    request(app)
      .put(endpointOf(id, 'per-page-notifications'))
      .set('X-Forwarded-For', ip)
      .send({ enabled });

  const getQueue = (query: Record<string, string> = {}) =>
    request(app).get(`${MOUNT_PATH}/review-queue`).query(query);

  const bearer = (token: string) => `Bearer ${token}`;

  const activitiesAt = (endpoint: string) =>
    prisma.activities.findMany({ where: { ip, endpoint } });

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
    await kit.newApplier().apply(proposal._id, BACKGROUND, { ip });
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
    crowi = await loadCrowi();
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
    fixtures.readOnlyUser = await createUser(extraUsernames.readOnly, true);
    fixtures.addedUser = await createUser(extraUsernames.added, false);

    const oneDayLater = new Date(Date.now() + 1000 * 60 * 60 * 24);
    fixtures.reviewerWriteToken = (
      await AccessToken.generateToken(users.subscriber._id, oneDayLater, [
        SCOPE.WRITE.FEATURES.PAGE,
      ])
    ).token;
    fixtures.reviewerReadToken = (
      await AccessToken.generateToken(users.subscriber._id, oneDayLater, [
        SCOPE.READ.FEATURES.PAGE,
      ])
    ).token;

    const responseHelpers: { response: Record<string, unknown> } = {
      response: {},
    };
    addCustomFunctionToResponse(responseHelpers);
    app = express();
    // Activity rows carry req.ip; the suite's rows are found and removed by its ip.
    app.set('trust proxy', true);
    app.use(express.json());
    app.use((req: express.Request & { user?: IUserHasId }, res, next) => {
      Object.assign(res, responseHelpers.response);
      if (currentUser != null) {
        req.user = currentUser;
      }
      next();
    });
    service = createChangeProposalService(crowi, {
      applier: kit.newApplier(),
    });
    app.use(MOUNT_PATH, createChangeProposalRouter(crowi, { service }));
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
    const extraIds = [fixtures.readOnlyUser._id, fixtures.addedUser._id];
    await InAppNotification.deleteMany({ user: { $in: extraIds } });
    await AccessToken.deleteAllTokensByUserId(users.subscriber._id);
    await mongoose.model('User').deleteMany({ _id: { $in: extraIds } });
    await kit.tearDown();
  }, 60_000);

  return {
    kit,
    users,
    // The service behind the routes; read it inside tests, not at collection time.
    getService: () => service,
    fixtures,
    asUser,
    idOf,
    endpointOf,
    postReview,
    patchReviewers,
    getProposal,
    postAction,
    putPerPageNotifications,
    getQueue,
    bearer,
    onlyActivityAt,
    expectNoActivityAt,
    expectOneUnsettledAttempt,
    userInput,
    storedRef,
    reviewedProposal,
    requesterOnlyPage,
    settledReviewedProposal,
    activeReviewerIdsOf,
    setReviewersEnabled,
  };
};
