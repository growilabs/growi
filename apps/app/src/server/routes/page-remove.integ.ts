/**
 * Integration test — POST /_api/pages.remove must not soft delete a non-empty page
 * unless the caller says which revision it saw, and that revision is still the latest.
 *
 * The handler checks this through `page.isUpdatable(revision_id)`, which is async:
 * before the fix this test ships with, the bare call returned a truthy Promise, `!` of
 * it was always false, and the page was deleted whatever `revision_id` said — or did
 * not say.
 *
 * The two refusals are deliberately separate. A missing `revision_id` is answered with
 * `invalid_body` before `isUpdatable` is consulted, because `isUpdatable` cannot tell
 * "you did not tell me" apart from "what you told me is stale" and would report the
 * latter. This mirrors apiv3 PUT /pages/rename.
 *
 * apiv1 reports failures as HTTP 200 with `ok: false` and a `code`, so these cases
 * assert on the body rather than on the status.
 *
 * Fixture and cleanup conventions follow apiv3/pages/rename.integ.ts: `app:isV5Compatible`
 * is pinned and restored, pages are built through `pageService.create` with the sub
 * operation awaited, and everything written lives under one path prefix — which for a
 * soft delete has to include the /trash copy.
 */

import { getIdStringForRef, type IUserHasId } from '@growi/core';
import { ConfigSource } from '@growi/core/dist/interfaces';
import { escapeStringForMongoRegex } from '@growi/core/dist/utils';
import type { Request } from 'express';
import express from 'express';
import mongoose, { type HydratedDocument, Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument } from '~/server/models/page';
import PageOperation from '~/server/models/page-operation';
import { prisma } from '~/utils/prisma';

type AuthenticatedRequest = Request & {
  user?: HydratedDocument<IUserHasId>;
};

const FIXTURE_ROOT = '/page-remove-route-integ';
const targetPath = `${FIXTURE_ROOT}/target`;

const requesterUsername = 'page-remove-route-integ-requester';

// Sentinel ip (reached via X-Forwarded-For) so cleanup removes only the activity rows
// this suite created. Keep it distinct from the sentinels sibling suites use.
const TEST_IP = '10.0.0.116';

// A soft delete moves the page under /trash, so cleanup has to match both places.
const fixturePathPattern = new RegExp(
  `^(/trash)?${escapeStringForMongoRegex(FIXTURE_ROOT)}(/|$)`,
);

describe('POST /pages.remove', () => {
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

    app = express();
    app.set('trust proxy', true);
    app.use(express.json());
    app.use((req: AuthenticatedRequest, _res, next) => {
      req.user = requester;
      next();
    });

    // The terminal handler only, without the auth chain and the body validators the
    // real mount puts in front of it — none of them touch revision_id.
    const { setup } = await import('./page');
    const actions = setup(crowi, app);
    app.post('/pages.remove', actions.api.remove);

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

  it('refuses a non-empty page sent without revision_id', async () => {
    const page = await createPage(targetPath, 'target body');

    const response = await request(app)
      .post('/pages.remove')
      .set('X-Forwarded-For', TEST_IP)
      .send({ page_id: page._id.toString() });

    expect(response.body).toMatchObject({ ok: false, code: 'invalid_body' });

    const survivingPage = await crowi.models.Page.findById(page._id);
    expect(survivingPage?.path).toBe(targetPath);
    expect(survivingPage?.status).toBe('published');
  });

  it('refuses a revision_id that is not the latest revision', async () => {
    const page = await createPage(targetPath, 'target body');

    const response = await request(app)
      .post('/pages.remove')
      .set('X-Forwarded-For', TEST_IP)
      .send({
        page_id: page._id.toString(),
        revision_id: new Types.ObjectId().toString(),
      });

    expect(response.body).toMatchObject({ ok: false, code: 'outdated' });

    const survivingPage = await crowi.models.Page.findById(page._id);
    expect(survivingPage?.path).toBe(targetPath);
    expect(survivingPage?.status).toBe('published');
  });

  it('deletes a page whose revision_id is the latest revision', async () => {
    const page = await createPage(targetPath, 'target body');

    const response = await request(app)
      .post('/pages.remove')
      .set('X-Forwarded-For', TEST_IP)
      .send({
        page_id: page._id.toString(),
        revision_id: latestRevisionIdOf(page),
      });

    // Without this case, refusing every request would also pass the two above.
    expect(response.body).toMatchObject({ ok: true, path: targetPath });

    const deletedPage = await crowi.models.Page.findById(page._id);
    expect(deletedPage?.path).toBe(`/trash${targetPath}`);
    expect(deletedPage?.status).toBe('deleted');
  });
});
