/**
 * Integration coverage for POST /pages/duplicate source availability.
 *
 * The page lookup and duplicate service run against the real Crowi/Mongo test
 * instance. Only authentication, activity, and notification boundaries are
 * isolated so the assertions stay focused on the HTTP and persistence contract.
 */

import { getIdStringForRef, type IUserHasId, PageGrant } from '@growi/core';
import { ConfigSource } from '@growi/core/dist/interfaces';
import { escapeStringForMongoRegex } from '@growi/core/dist/utils';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import mongoose, { type HydratedDocument, Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type { IOptionsForCreate } from '~/interfaces/page';
import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';
import PageOperation from '~/server/models/page-operation';
import Subscription from '~/server/models/subscription';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';
import { prisma } from '~/utils/prisma';

type AuthenticatedRequest = Request & {
  user?: HydratedDocument<IUserHasId>;
};

const passthroughMiddleware = (
  _req: Request,
  _res: Response,
  next: NextFunction,
) => next();

const addTestActivity = (_req: Request, res: Response, next: NextFunction) => {
  res.locals.activity = { _id: '507f1f77bcf86cd799439011' };
  next();
};

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: () => passthroughMiddleware,
}));

vi.mock('~/server/middlewares/login-required', () => ({
  default: () => passthroughMiddleware,
}));

vi.mock('~/server/middlewares/admin-required', () => ({
  default: () => passthroughMiddleware,
}));

vi.mock('../../../middlewares/add-activity', () => ({
  generateAddActivityMiddleware: () => addTestActivity,
}));

const FIXTURE_ROOT = '/duplicate-route-integ';
const ACCESSIBLE_SOURCE = `${FIXTURE_ROOT}/accessible-source`;
const FORBIDDEN_SOURCE = `${FIXTURE_ROOT}/forbidden-source`;
const EMPTY_SOURCE = `${FIXTURE_ROOT}/empty-source`;
const MISSING_DESTINATION = `${FIXTURE_ROOT}/missing-destination`;
const FORBIDDEN_DESTINATION = `${FIXTURE_ROOT}/forbidden-destination`;
const SUCCESS_DESTINATION = `${FIXTURE_ROOT}/success-destination`;
const EMPTY_DESTINATION = `${FIXTURE_ROOT}/empty-destination`;
const SOURCE_BODY = 'Duplicate route integration source body';
const REQUESTER_USERNAME = 'duplicate-route-integ-requester';
const OWNER_USERNAME = 'duplicate-route-integ-owner';

const fixturePathPattern = new RegExp(
  `^${escapeStringForMongoRegex(FIXTURE_ROOT)}(/|$)`,
);

describe('POST /duplicate', () => {
  let app: express.Application;
  let crowi: Crowi;
  let requester: HydratedDocument<IUserHasId>;
  let owner: HydratedDocument<IUserHasId>;
  let rootPage: HydratedDocument<PageDocument>;
  let rootPageWasCreated = false;
  let rootDescendantCount: number;
  let isV5CompatibleInDbBefore: boolean | undefined;
  let disableUserPagesInDbBefore: boolean | undefined;

  const waitForPageOperationToSettle = async (
    fromPath: string,
    maxWaitMs = 10_000,
  ): Promise<void> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < maxWaitMs) {
      // biome-ignore lint/performance/noAwaitInLoops: polling must observe each completed database read before retrying
      if ((await PageOperation.findOne({ fromPath })) == null) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(
      `PageOperation for ${fromPath} did not settle within ${maxWaitMs}ms`,
    );
  };

  const createPage = async (
    path: string,
    body: string,
    user: HydratedDocument<IUserHasId>,
    options: IOptionsForCreate = {},
  ): Promise<HydratedDocument<PageDocument>> => {
    const page = await crowi.pageService.create(path, body, user, options);
    await waitForPageOperationToSettle(path);
    return page;
  };

  const revisionIdOf = (page: HydratedDocument<PageDocument>): string => {
    const { revision } = page;
    if (revision == null) {
      throw new Error(`the page at ${page.path} must have a revision`);
    }
    return getIdStringForRef(revision);
  };

  const postDuplicate = (
    pageId: string,
    pageNameInput: string,
    isRecursively = false,
  ) =>
    request(app)
      .post('/duplicate')
      .send({
        pageId,
        pageNameInput,
        isRecursively,
        onlyDuplicateUserRelatedResources: false,
      })
      .timeout({ deadline: 3_000 });

  const removeFixtures = async (): Promise<void> => {
    const { Page } = crowi.models;
    const fixturePageIds = (
      await Page.find({ path: fixturePathPattern }, { _id: 1 })
    ).map((page) => page._id.toString());

    await PageOperation.deleteMany({
      $or: [{ fromPath: fixturePathPattern }, { toPath: fixturePathPattern }],
    });
    await Subscription.deleteMany({ target: { $in: fixturePageIds } });
    await prisma.revisions.deleteMany({
      where: { pageId: { in: fixturePageIds } },
    });
    await Page.deleteMany({ path: fixturePathPattern });

    if (rootDescendantCount != null) {
      await Page.updateOne(
        { _id: rootPage._id },
        { $set: { descendantCount: rootDescendantCount } },
      );
    }
  };

  beforeAll(async () => {
    crowi = await getInstance();
    const { Page } = crowi.models;
    const User = mongoose.model<IUserHasId>('User');

    isV5CompatibleInDbBefore = crowi.configManager.getConfig(
      'app:isV5Compatible',
      ConfigSource.db,
    );
    disableUserPagesInDbBefore = crowi.configManager.getConfig(
      'security:disableUserPages',
      ConfigSource.db,
    );
    await crowi.configManager.updateConfig('app:isV5Compatible', true);

    await User.deleteMany({
      username: { $in: [REQUESTER_USERNAME, OWNER_USERNAME] },
    });

    const existingRootPage = await Page.findOne({ path: '/' });
    rootPage =
      existingRootPage ??
      (await Page.create({ path: '/', grant: PageGrant.GRANT_PUBLIC }));
    rootPageWasCreated = existingRootPage == null;

    requester = await User.create({
      name: REQUESTER_USERNAME,
      username: REQUESTER_USERNAME,
      email: `${REQUESTER_USERNAME}@example.com`,
    });
    owner = await User.create({
      name: OWNER_USERNAME,
      username: OWNER_USERNAME,
      email: `${OWNER_USERNAME}@example.com`,
    });

    await crowi.setUpGlobalNotification();
    vi.spyOn(crowi.globalNotificationService, 'fire').mockResolvedValue(
      undefined,
    );
    vi.spyOn(
      crowi.inAppNotificationService,
      'createSubscription',
    ).mockResolvedValue(undefined);
    vi.spyOn(crowi.events.activity, 'emit').mockReturnValue(true);

    const responseHelpers: { response: Record<string, unknown> } = {
      response: {},
    };
    addCustomFunctionToResponse(responseHelpers);

    app = express();
    app.use(express.json());
    app.use((_req, res, next) => {
      Object.assign(res, responseHelpers.response);
      next();
    });
    app.use((req: AuthenticatedRequest, _res, next) => {
      req.user = requester;
      next();
    });

    const { setup } = await import('./index');
    app.use('/', setup(crowi));

    await removeFixtures();
    rootDescendantCount =
      (await Page.findById(rootPage._id))?.descendantCount ?? 0;
  }, 120_000);

  beforeEach(async () => {
    await crowi.configManager.updateConfig('security:disableUserPages', true);
  });

  afterEach(async () => {
    try {
      await removeFixtures();
    } finally {
      await crowi.configManager.updateConfigs(
        { 'security:disableUserPages': disableUserPagesInDbBefore },
        { removeIfUndefined: true },
      );
      expect(
        crowi.configManager.getConfig(
          'security:disableUserPages',
          ConfigSource.db,
        ),
      ).toBe(disableUserPagesInDbBefore);
    }
  });

  afterAll(async () => {
    try {
      await removeFixtures();
      await crowi.models.User.deleteMany({
        username: { $in: [REQUESTER_USERNAME, OWNER_USERNAME] },
      });
      if (rootPageWasCreated) {
        await crowi.models.Page.deleteOne({ _id: rootPage._id });
      }
    } finally {
      try {
        await crowi.configManager.updateConfigs(
          {
            'app:isV5Compatible': isV5CompatibleInDbBefore,
            'security:disableUserPages': disableUserPagesInDbBefore,
          },
          { removeIfUndefined: true },
        );
        expect(
          crowi.configManager.getConfig('app:isV5Compatible', ConfigSource.db),
        ).toBe(isV5CompatibleInDbBefore);
        expect(
          crowi.configManager.getConfig(
            'security:disableUserPages',
            ConfigSource.db,
          ),
        ).toBe(disableUserPagesInDbBefore);
      } finally {
        vi.restoreAllMocks();
      }
    }
  });

  it('returns 404 without creating a destination when the source does not exist', async () => {
    const pageId = new Types.ObjectId();

    const response = await postDuplicate(
      pageId.toString(),
      MISSING_DESTINATION,
    );

    expect(response.status).toBe(404);
    expect(response.body.errors).toEqual([
      expect.objectContaining({
        code: 'notfound_or_forbidden',
        message: `Page '${pageId}' is not found or forbidden`,
      }),
    ]);
    expect(
      await crowi.models.Page.exists({ path: MISSING_DESTINATION }),
    ).toBeNull();
  });

  it('returns 404 without changing the source when the requester may not read it', async () => {
    const sourcePage = await createPage(FORBIDDEN_SOURCE, SOURCE_BODY, owner, {
      grant: PageGrant.GRANT_OWNER,
    });
    const sourceRevisionId = revisionIdOf(sourcePage);

    const response = await postDuplicate(
      sourcePage._id.toString(),
      FORBIDDEN_DESTINATION,
    );

    expect(response.status).toBe(404);
    expect(response.body.errors).toEqual([
      expect.objectContaining({
        code: 'notfound_or_forbidden',
        message: `Page '${sourcePage._id}' is not found or forbidden`,
      }),
    ]);
    expect(
      await crowi.models.Page.exists({ path: FORBIDDEN_DESTINATION }),
    ).toBeNull();

    const untouchedSource = await crowi.models.Page.findById(sourcePage._id);
    if (untouchedSource == null) {
      throw new Error('the forbidden source was unexpectedly removed');
    }
    expect(untouchedSource.path).toBe(FORBIDDEN_SOURCE);
    expect(revisionIdOf(untouchedSource)).toBe(sourceRevisionId);
  });

  it('duplicates an accessible source with its content', async () => {
    const sourcePage = await createPage(
      ACCESSIBLE_SOURCE,
      SOURCE_BODY,
      requester,
    );

    const response = await postDuplicate(
      sourcePage._id.toString(),
      SUCCESS_DESTINATION,
    );

    expect(response.status).toBe(200);
    expect(response.body.page.path).toBe(SUCCESS_DESTINATION);

    await waitForPageOperationToSettle(SUCCESS_DESTINATION);
    const duplicatedPage = await crowi.models.Page.findOne({
      path: SUCCESS_DESTINATION,
    });
    expect(duplicatedPage).not.toBeNull();
    if (duplicatedPage == null) {
      throw new Error('the duplicated page was not persisted');
    }
    expect(duplicatedPage.grant).toBe(sourcePage.grant);

    const duplicatedRevision = await prisma.revisions.findFirst({
      where: { pageId: duplicatedPage._id.toString() },
    });
    expect(duplicatedRevision?.body).toBe(SOURCE_BODY);
  });

  it('returns 404 for a non-recursive empty source', async () => {
    await createPage(`${EMPTY_SOURCE}/child`, SOURCE_BODY, requester);
    const emptySourcePage = await crowi.models.Page.findOne({
      path: EMPTY_SOURCE,
    });
    if (emptySourcePage == null) {
      throw new Error('the empty source fixture was not created');
    }
    expect(emptySourcePage.isEmpty).toBe(true);

    const response = await postDuplicate(
      emptySourcePage._id.toString(),
      EMPTY_DESTINATION,
    );

    expect(response.status).toBe(404);
    expect(response.body.errors).toEqual([
      expect.objectContaining({
        code: 'notfound_or_forbidden',
        message: `Page '${emptySourcePage._id}' is not found or forbidden`,
      }),
    ]);
    expect(
      await crowi.models.Page.exists({ path: EMPTY_DESTINATION }),
    ).toBeNull();
  });
});
