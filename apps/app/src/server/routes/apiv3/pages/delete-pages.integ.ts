/**
 * Integration test — POST /pages/delete must not soft delete a page whose
 * revisionId is no longer the latest.
 *
 * The route filters the selected pages through `page.isUpdatable(revisionId)`, so a
 * page updated since the given revision must be left in place.
 *
 * The deletion authority (`pageService.deletePagesWithAuthority`) must leave a page
 * the requester is not allowed to delete in place as well.
 *
 * The deletion runs in the background after the route answers, so a case that
 * deletes pages waits for that work to settle before asserting and cleaning up.
 *
 * The fixture and cleanup conventions are the ones documented at the top of
 * rename.integ.ts: `app:isV5Compatible` is pinned and restored, pages are built
 * through `pageService.create` with the sub operation awaited, everything written
 * lives under one path prefix, and the response helpers are installed per request on
 * this suite's own app rather than on the express module's shared response object.
 */

import { getIdStringForRef, type IUserHasId } from '@growi/core';
import { ConfigSource } from '@growi/core/dist/interfaces';
import { escapeStringForMongoRegex } from '@growi/core/dist/utils';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import mongoose, { type HydratedDocument, Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import { PageDeleteConfigValue } from '~/interfaces/page-delete-config';
import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';
import PageOperation from '~/server/models/page-operation';
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

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: () => passthroughMiddleware,
}));

vi.mock('~/server/middlewares/login-required', () => ({
  default: () => passthroughMiddleware,
}));

vi.mock('~/server/middlewares/admin-required', () => ({
  default: () => passthroughMiddleware,
}));

const FIXTURE_ROOT = '/delete-pages-route-integ';
const targetPath = `${FIXTURE_ROOT}/target`;

const requesterUsername = 'delete-pages-route-integ-requester';

// Sentinel ip (reached via X-Forwarded-For) so cleanup removes only the activity rows
// this suite created. Keep it distinct from the sentinels sibling suites use.
const TEST_IP = '10.0.0.115';

// A soft delete moves the page under /trash, so cleanup has to match both places.
const fixturePathPattern = new RegExp(
  `^(/trash)?${escapeStringForMongoRegex(FIXTURE_ROOT)}(/|$)`,
);

describe('POST /delete', () => {
  let app: express.Application;
  let crowi: Crowi;
  let requester: HydratedDocument<IUserHasId>;
  let rootPage: HydratedDocument<PageDocument>;
  let rootPageWasCreated = false;
  let rootDescendantCount: number;
  let isV5CompatibleInDbBefore: boolean | undefined;

  const createPage = async (
    path: string,
    body: string,
  ): Promise<HydratedDocument<PageDocument>> => {
    const createSubOperationSpy = vi
      .spyOn(crowi.pageService, 'createSubOperation')
      .mockResolvedValue();

    const created = await crowi.pageService.create(path, body, requester, {});

    const argsForCreateSubOperation = createSubOperationSpy.mock.calls[0];
    createSubOperationSpy.mockRestore();
    await crowi.pageService.createSubOperation(
      ...(argsForCreateSubOperation as Parameters<
        typeof crowi.pageService.createSubOperation
      >),
    );

    return created;
  };

  const latestRevisionIdOf = (page: HydratedDocument<PageDocument>): string => {
    const { revision } = page;
    if (revision == null) {
      throw new Error('the fixture page must have a revision');
    }
    return getIdStringForRef(revision);
  };

  /**
   * The route answers before `deleteMultiplePages` finishes — it is fired without
   * being awaited — so wait for the page document to reach the deleted state before
   * asserting on it or cleaning up around it.
   */
  const waitForPageToBeDeleted = async (
    pageId: Types.ObjectId,
    maxWaitMs = 10_000,
  ): Promise<HydratedDocument<PageDocument>> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < maxWaitMs) {
      const page = await crowi.models.Page.findById(pageId);
      if (page?.status === 'deleted') {
        return page;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`page ${pageId} was not deleted within ${maxWaitMs}ms`);
  };

  /**
   * `PageService#deletePage` moves the target into the trash (the state
   * `waitForPageToBeDeleted` polls for) and only afterwards awaits
   * `updateDescendantCountOfAncestors` on `page.parent` — still inside the same
   * unawaited background chain the route fired. Resolving as soon as the target
   * reaches `deleted` let a suite's `afterEach` fixture cleanup delete that parent
   * (an auto-created empty page under the fixture root) before the still-in-flight
   * count update looked it up, throwing an unhandled `Target not found` rejection
   * (see #11740).
   *
   * The parent's descendantCount itself is not a safe thing to poll for: trashing
   * the target also clears the target's own `parent` (see `deleteNonEmptyTarget`),
   * so once the count update finishes, the very next awaited step in the same
   * chain — `Page.removeLeafEmptyPagesRecursively` — finds this now-childless
   * empty ancestor and deletes it, all within the same tick. A "count decremented"
   * window this narrow is not reliably observable by a 50ms poll. The ancestor's
   * *removal* is the last mutation in the chain and, unlike the count, a stable
   * terminal state — waiting for that instead proves the whole chain (including
   * the vulnerable count update) has already settled.
   */
  const waitForAncestorCleanupToSettle = async (
    parentId: string,
    maxWaitMs = 10_000,
  ): Promise<void> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < maxWaitMs) {
      const parent = await crowi.models.Page.findById(parentId);
      if (parent == null) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(
      `ancestor ${parentId} was not cleaned up within ${maxWaitMs}ms`,
    );
  };

  const removeFixtures = async (): Promise<void> => {
    const { Page } = crowi.models;

    const fixturePageIds = (
      await Page.find({ path: fixturePathPattern }, { _id: 1 })
    ).map((page) => page._id.toString());
    await prisma.revisions.deleteMany({
      where: { pageId: { in: fixturePageIds } },
    });
    await Page.deleteMany({ path: fixturePathPattern });
    await PageOperation.deleteMany({ fromPath: fixturePathPattern });
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });

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
    await crowi.configManager.updateConfig('app:isV5Compatible', true);

    await User.deleteMany({ username: requesterUsername });

    const existingRootPage = await Page.findOne({ path: '/' });
    rootPage = existingRootPage ?? (await Page.create({ path: '/', grant: 1 }));
    rootPageWasCreated = existingRootPage == null;

    requester = await User.create({
      name: requesterUsername,
      username: requesterUsername,
      email: `${requesterUsername}@example.com`,
    });

    const responseHelpers: { response: Record<string, unknown> } = {
      response: {},
    };
    addCustomFunctionToResponse(responseHelpers);

    app = express();
    app.set('trust proxy', true);
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

  afterEach(async () => {
    await removeFixtures();
  });

  afterAll(async () => {
    await removeFixtures();
    await crowi.models.User.deleteMany({ username: requesterUsername });
    if (rootPageWasCreated) {
      await crowi.models.Page.deleteOne({ _id: rootPage._id });
    }
    await crowi.configManager.updateConfigs(
      { 'app:isV5Compatible': isV5CompatibleInDbBefore },
      { removeIfUndefined: true },
    );
  });

  it('keeps a page whose revisionId is not the latest revision', async () => {
    const page = await createPage(targetPath, 'target body');

    const response = await request(app)
      .post('/delete')
      .set('X-Forwarded-For', TEST_IP)
      .send({
        pageIdToRevisionIdMap: {
          [page._id.toString()]: new Types.ObjectId().toString(),
        },
      });

    expect(response.status).toBe(409);
    expect(response.body.errors).toEqual([
      expect.objectContaining({ code: 'outdated' }),
    ]);

    const survivingPage = await crowi.models.Page.findById(page._id);
    expect(survivingPage?.path).toBe(targetPath);
    expect(survivingPage?.status).toBe('published');
  });

  // Explicit timeout: two sequential 10s-cap polling waits below (target status,
  // then ancestor cleanup) can exceed vitest's 5s default under CI load.
  it('deletes a page whose revisionId is the latest revision', async () => {
    const page = await createPage(targetPath, 'target body');
    if (page.parent == null) {
      throw new Error('the fixture page must have a parent');
    }
    const parentId = getIdStringForRef(page.parent);

    const response = await request(app)
      .post('/delete')
      .set('X-Forwarded-For', TEST_IP)
      .send({
        pageIdToRevisionIdMap: {
          [page._id.toString()]: latestRevisionIdOf(page),
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.paths).toEqual([targetPath]);

    // Without this case, filtering every page out unconditionally would also pass.
    const deletedPage = await waitForPageToBeDeleted(page._id);
    expect(deletedPage.path).toBe(`/trash${targetPath}`);

    // Wait for the rest of the background chain (ending in the now-childless
    // fixture-root ancestor's own removal) to settle too, so afterEach's
    // fixture cleanup can't race it.
    await waitForAncestorCleanupToSettle(parentId);
  }, 20_000);

  it('deletes the selected pages and their descendants under the default settings', async () => {
    const pageA = await createPage(`${FIXTURE_ROOT}/a`, 'a body');
    const childOfA = await createPage(`${FIXTURE_ROOT}/a/child`, 'child body');
    const pageB = await createPage(`${FIXTURE_ROOT}/b`, 'b body');
    if (pageA.parent == null) {
      throw new Error('the fixture page must have a parent');
    }
    const parentId = getIdStringForRef(pageA.parent);

    const response = await request(app)
      .post('/delete')
      .set('X-Forwarded-For', TEST_IP)
      .send({
        pageIdToRevisionIdMap: {
          [pageA._id.toString()]: latestRevisionIdOf(pageA),
          [pageB._id.toString()]: latestRevisionIdOf(pageB),
        },
        isRecursively: true,
      });

    expect(response.status).toBe(200);
    for (const page of [pageA, childOfA, pageB]) {
      const deletedPage = await waitForPageToBeDeleted(page._id);
      expect(deletedPage.path).toBe(`/trash${page.path}`);
    }

    await waitForAncestorCleanupToSettle(parentId);
    await vi.waitFor(
      async () => {
        expect(
          await PageOperation.countDocuments({ fromPath: fixturePathPattern }),
        ).toBe(0);
      },
      { timeout: 10_000 },
    );
  }, 30_000);

  it('keeps a page the requester is not allowed to delete', async () => {
    const page = await createPage(targetPath, 'target body');
    // The requester authored the page but is not an admin, so AdminOnly
    // forbids the deletion.
    await crowi.configManager.updateConfig(
      'security:pageDeletionAuthority',
      PageDeleteConfigValue.AdminOnly,
    );

    try {
      const response = await request(app)
        .post('/delete')
        .set('X-Forwarded-For', TEST_IP)
        .send({
          pageIdToRevisionIdMap: {
            [page._id.toString()]: latestRevisionIdOf(page),
          },
        });

      expect(response.status).toBe(403);
      expect(response.body.errors).toEqual([
        expect.objectContaining({ code: 'deletion_not_allowed_for_user' }),
      ]);
      const survivingPage = await crowi.models.Page.findById(page._id);
      expect(survivingPage?.path).toBe(targetPath);
      expect(survivingPage?.status).toBe('published');
    } finally {
      await crowi.configManager.updateConfig(
        'security:pageDeletionAuthority',
        undefined,
        { removeIfUndefined: true },
      );
    }
  });

  it('keeps a page the requester is not allowed to delete completely', async () => {
    const page = await createPage(targetPath, 'target body');
    await crowi.configManager.updateConfig(
      'security:pageCompleteDeletionAuthority',
      PageDeleteConfigValue.AdminOnly,
    );

    try {
      const response = await request(app)
        .post('/delete')
        .set('X-Forwarded-For', TEST_IP)
        .send({
          pageIdToRevisionIdMap: {
            [page._id.toString()]: latestRevisionIdOf(page),
          },
          isCompletely: true,
        });

      expect(response.status).toBe(403);
      expect(response.body.errors).toEqual([
        expect.objectContaining({
          code: 'complete_deletion_not_allowed_for_user',
        }),
      ]);
      const survivingPage = await crowi.models.Page.findById(page._id);
      expect(survivingPage?.path).toBe(targetPath);
    } finally {
      await crowi.configManager.updateConfig(
        'security:pageCompleteDeletionAuthority',
        undefined,
        { removeIfUndefined: true },
      );
    }
  });

  it('does not crash when isAnyoneWithTheLink is set and the page cannot be found', async () => {
    // `pageIds.length !== 1` is rejected earlier when isAnyoneWithTheLink is
    // set, so the viewer-filtered lookup below resolves for a single id, and a
    // nonexistent (or unreadable) pageId leaves `pagesToDelete` empty.
    const missingPageId = new Types.ObjectId();

    const response = await request(app)
      .post('/delete')
      .set('X-Forwarded-For', TEST_IP)
      .send({
        pageIdToRevisionIdMap: {
          [missingPageId.toString()]: new Types.ObjectId().toString(),
        },
        isAnyoneWithTheLink: true,
      });

    // The same uniform 404 as an unreadable page, so the response does not
    // reveal whether the page exists. The code tells this answer apart from the
    // sibling "grant of the retrieved page is not restricted" error.
    expect(response.status).toBe(404);
    expect(response.body.errors).toEqual([
      expect.objectContaining({ code: 'notfound_or_forbidden' }),
    ]);
  });
});
