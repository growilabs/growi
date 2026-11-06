/**
 * Integration test — PUT /pages/rename must answer with the canonical status for
 * every outcome: 404 (no such page, or the page exists but the requester may not
 * read it — the two are intentionally indistinguishable to the caller, see
 * apps/app/.claude/rules/page-write-action-403-404.md), 400 (a non-empty page
 * renamed without revisionId), 409 (revisionId is not the latest) and 200
 * (renamed). PR #11615 first split the single 401 this route used to return into
 * 403 / 404; that distinction was later found to leak page existence to callers
 * without read access and was collapsed back to a uniform 404.
 *
 * Why the fixtures look the way they do:
 *
 * - `app:isV5Compatible` is pinned in beforeAll and put back in afterAll. Installed
 *   instances run with it ON (see service/installer.ts) and the rename forks on it
 *   (see service/page/should-use-v4-process.ts), so leaving it at its default would
 *   exercise the legacy v4 rename instead of the one users actually hit. It cannot be
 *   left ambient either: the value lives in the `configs` collection, one database is
 *   shared by every file its vitest worker runs, and a dozen sibling files switch it
 *   on without putting it back — so an unpinned suite reads whatever the file before
 *   it happened to leave behind.
 *
 * - Fixture pages go through `crowi.pageService.create` with the detached sub
 *   operation awaited (the pattern in service/page/grant-preserve-on-update.integ.ts),
 *   so each one is a real v5 page with a consistent parent link, revision and
 *   descendantCount. Hand-built `Page.create` documents are not enough: the route
 *   reads `page.isEmpty` and `page.isUpdatable(revisionId)`, and the v5 rename walks
 *   the parent links.
 *
 * - Descendant renaming is deliberately NOT asserted here. This route's own job ends
 *   at choosing the status code and handing the page to `pageService.renamePage`;
 *   recursive rename is covered by service/page/v5.public-page.integ.ts. What the
 *   suite does have to do is wait for the detached rename sub operation to settle, so
 *   its background writes cannot land after the fixtures have been cleaned up.
 *
 * - `res.apiv3` / `res.apiv3Err` are installed per request on this suite's own app.
 *   Handing the express module to `addCustomFunctionToResponse` (what production
 *   does) would write them onto that module's shared response object, which every app
 *   built later in the same worker inherits and nothing resets.
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

// Every path this suite writes lives under here, so cleanup can match by prefix:
// a rename also creates the empty ancestor page of its destination, which a list of
// known paths would miss.
const FIXTURE_ROOT = '/rename-route-integ';
const sourcePath = `${FIXTURE_ROOT}/source`;
const renamedPath = `${FIXTURE_ROOT}/renamed`;
const forbiddenPath = `${FIXTURE_ROOT}/forbidden`;

const requesterUsername = 'rename-route-integ-requester';
const ownerUsername = 'rename-route-integ-owner';

// Sentinel ip (reached via X-Forwarded-For) so cleanup removes only the activity
// rows this suite created — the `activities` rows of every sibling suite live in the
// same database. Keep it distinct from the sentinels those suites use.
const TEST_IP = '10.0.0.114';

const fixturePathPattern = new RegExp(
  `^${escapeStringForMongoRegex(FIXTURE_ROOT)}(/|$)`,
);

describe('PUT /rename', () => {
  let app: express.Application;
  let crowi: Crowi;
  let requester: HydratedDocument<IUserHasId>;
  let owner: HydratedDocument<IUserHasId>;
  let rootPage: HydratedDocument<PageDocument>;
  let rootPageWasCreated = false;
  let rootDescendantCount: number;
  let isV5CompatibleInDbBefore: boolean | undefined;

  /**
   * Create a real v5 page. `create` fires its sub operation without awaiting it, so
   * run that explicitly to keep the fixture deterministic (and to leave no
   * PageOperation document behind).
   */
  const createPage = async (
    path: string,
    body: string,
    user: HydratedDocument<IUserHasId>,
    options: IOptionsForCreate = {},
  ): Promise<HydratedDocument<PageDocument>> => {
    const createSubOperationSpy = vi
      .spyOn(crowi.pageService, 'createSubOperation')
      .mockResolvedValue();

    const created = await crowi.pageService.create(path, body, user, options);

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
   * The v5 rename calls `renameSubOperation` without awaiting it, and that operation
   * deletes the PageOperation document once it is done. Wait for that so its writes
   * cannot outlive the test.
   */
  const waitForRenameToSettle = async (
    fromPath: string,
    maxWaitMs = 10_000,
  ): Promise<void> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < maxWaitMs) {
      if ((await PageOperation.countDocuments({ fromPath })) === 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(
      `the rename from ${fromPath} did not settle within ${maxWaitMs}ms`,
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

    // Creating and renaming under the root page bumps its descendantCount, and the
    // root page is shared with every other file using this database.
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

    // Read the value stored in the database, not the effective one, so afterAll can
    // leave the `configs` collection exactly as it found it (no row when there was
    // none) for every other file sharing this database.
    isV5CompatibleInDbBefore = crowi.configManager.getConfig(
      'app:isV5Compatible',
      ConfigSource.db,
    );
    await crowi.configManager.updateConfig('app:isV5Compatible', true);

    await User.deleteMany({
      username: { $in: [requesterUsername, ownerUsername] },
    });

    const existingRootPage = await Page.findOne({ path: '/' });
    rootPage =
      existingRootPage ??
      (await Page.create({ path: '/', grant: PageGrant.GRANT_PUBLIC }));
    rootPageWasCreated = existingRootPage == null;

    requester = await User.create({
      name: requesterUsername,
      username: requesterUsername,
      email: `${requesterUsername}@example.com`,
    });
    owner = await User.create({
      name: ownerUsername,
      username: ownerUsername,
      email: `${ownerUsername}@example.com`,
    });

    // Install the real apiv3 helpers on this suite's responses only — see the file
    // header for why the express module must not be handed over here.
    const responseHelpers: { response: Record<string, unknown> } = {
      response: {},
    };
    addCustomFunctionToResponse(responseHelpers);

    app = express();
    // Make req.ip the sentinel above: it is what renamePage records on its activity.
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

    // Drop anything a previous interrupted run left behind, then record the root
    // page's descendantCount as the value every test must restore it to.
    await removeFixtures();
    rootDescendantCount =
      (await Page.findById(rootPage._id))?.descendantCount ?? 0;
  }, 120_000);

  afterEach(async () => {
    await removeFixtures();
  });

  afterAll(async () => {
    await removeFixtures();
    await crowi.models.User.deleteMany({
      username: { $in: [requesterUsername, ownerUsername] },
    });
    if (rootPageWasCreated) {
      await crowi.models.Page.deleteOne({ _id: rootPage._id });
    }
    await crowi.configManager.updateConfigs(
      { 'app:isV5Compatible': isV5CompatibleInDbBefore },
      { removeIfUndefined: true },
    );
  });

  it('returns 404 when the page does not exist', async () => {
    const pageId = new Types.ObjectId();

    const response = await request(app)
      .put('/rename')
      .set('X-Forwarded-For', TEST_IP)
      .send({ pageId: pageId.toString(), newPagePath: renamedPath });

    expect(response.status).toBe(404);
    expect(response.body.errors).toEqual([
      expect.objectContaining({
        code: 'notfound_or_forbidden',
        message: `Page '${pageId}' is not found or forbidden`,
      }),
    ]);
  });

  it('returns 404 (not 403) and leaves the page untouched when the requester may not read it', async () => {
    const page = await createPage(forbiddenPath, 'forbidden body', owner, {
      grant: PageGrant.GRANT_OWNER,
    });

    // A valid revisionId is sent so this response can only come from the grant
    // filter — a missing one would be answered with 400 before the grant is ever
    // consulted.
    const response = await request(app)
      .put('/rename')
      .set('X-Forwarded-For', TEST_IP)
      .send({
        pageId: page._id.toString(),
        newPagePath: `${FIXTURE_ROOT}/forbidden-renamed`,
        revisionId: latestRevisionIdOf(page),
      });

    // Same status as the "page does not exist" case above — a requester without
    // read access must not be able to tell a forbidden page apart from a missing
    // one. See apps/app/.claude/rules/page-write-action-403-404.md.
    expect(response.status).toBe(404);
    expect(response.body.errors).toEqual([
      expect.objectContaining({
        code: 'notfound_or_forbidden',
        message: `Page '${page._id}' is not found or forbidden`,
      }),
    ]);

    const untouchedPage = await crowi.models.Page.findById(page._id);
    expect(untouchedPage?.path).toBe(forbiddenPath);
  });

  it('returns 400 when a non-empty page is renamed without revisionId', async () => {
    const page = await createPage(sourcePath, 'source body', requester);

    const response = await request(app)
      .put('/rename')
      .set('X-Forwarded-For', TEST_IP)
      .send({ pageId: page._id.toString(), newPagePath: renamedPath });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([
      expect.objectContaining({
        code: 'invalid_body',
        message: 'revisionId must be a mongoId',
      }),
    ]);

    const untouchedPage = await crowi.models.Page.findById(page._id);
    expect(untouchedPage?.path).toBe(sourcePath);
  });

  it('returns 409 when revisionId is not the latest revision', async () => {
    const page = await createPage(sourcePath, 'source body', requester);

    const response = await request(app)
      .put('/rename')
      .set('X-Forwarded-For', TEST_IP)
      .send({
        pageId: page._id.toString(),
        newPagePath: renamedPath,
        revisionId: new Types.ObjectId().toString(),
      });

    // Only the code is asserted: the message this route pairs with it still says
    // "couldn't delete", which is a wart a fix should be free to correct.
    expect(response.status).toBe(409);
    expect(response.body.errors).toEqual([
      expect.objectContaining({ code: 'notfound_or_forbidden' }),
    ]);

    const untouchedPage = await crowi.models.Page.findById(page._id);
    expect(untouchedPage?.path).toBe(sourcePath);
  });

  it('renames an accessible page', async () => {
    const page = await createPage(sourcePath, 'source body', requester);

    const response = await request(app)
      .put('/rename')
      .set('X-Forwarded-For', TEST_IP)
      .send({
        pageId: page._id.toString(),
        newPagePath: renamedPath,
        revisionId: latestRevisionIdOf(page),
      });

    expect(response.status).toBe(200);
    expect(response.body.page.path).toBe(renamedPath);

    await waitForRenameToSettle(sourcePath);

    const renamedPage = await crowi.models.Page.findById(page._id);
    expect(renamedPage?.path).toBe(renamedPath);
  });
});
