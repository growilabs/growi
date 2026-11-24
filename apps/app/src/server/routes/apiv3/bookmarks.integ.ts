import { type IUser, PageGrant } from '@growi/core';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import mongoose, { type HydratedDocument, type Types } from 'mongoose';
import request, { type Response as SupertestResponse } from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { PageDocument, PageModel } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import addCustomFunctionToResponse from './response';

// bookmarks / bookmarkfolders are Prisma-backed since v8, so fixtures go through
// Prisma. Pages, users and groups stay on mongoose (not yet migrated).
type BookmarkRow = Awaited<ReturnType<typeof prisma.bookmarks.create>>;

const seedUser = async (username: string): Promise<HydratedDocument<IUser>> => {
  const User = mongoose.model<IUser>('User');
  const [user] = await User.insertMany([
    { name: username, username, email: `${username}@example.com` },
  ]);
  return user;
};

interface SeedPageOptions {
  path: string;
  creator: HydratedDocument<IUser>;
  grant?: PageGrant;
  grantedUsers?: HydratedDocument<IUser>[];
  grantedGroups?: { item: Types.ObjectId; type: 'UserGroup' }[];
  isEmpty?: boolean;
}

const seedPage = async (
  options: SeedPageOptions,
): Promise<HydratedDocument<PageDocument>> => {
  const Page = mongoose.model<HydratedDocument<PageDocument>, PageModel>(
    'Page',
  );
  const { path, creator, grant = PageGrant.GRANT_PUBLIC } = options;
  const [page] = await Page.insertMany([
    {
      path,
      grant,
      creator: creator._id,
      grantedUsers: options.grantedUsers?.map((u) => u._id),
      grantedGroups: options.grantedGroups,
      isEmpty: options.isEmpty,
    },
  ]);
  return page;
};

const seedBookmark = (
  user: HydratedDocument<IUser>,
  page: HydratedDocument<PageDocument>,
): Promise<BookmarkRow> => {
  return prisma.bookmarks.create({
    data: { userId: user._id.toString(), pageId: page._id.toString() },
  });
};

const seedGroup = async (
  name: string,
): Promise<HydratedDocument<{ name: string }>> => {
  const UserGroup = mongoose.model<{ name: string }>('UserGroup');
  const [group] = await UserGroup.insertMany([{ name }]);
  return group;
};

const addUserToGroup = async (
  group: HydratedDocument<{ name: string }>,
  user: HydratedDocument<IUser>,
): Promise<void> => {
  const UserGroupRelation = mongoose.model<{
    relatedGroup: Types.ObjectId;
    relatedUser: Types.ObjectId;
  }>('UserGroupRelation');
  await UserGroupRelation.insertMany([
    { relatedGroup: group._id, relatedUser: user._id },
  ]);
};

// Extract the page ids present in the API response (deleted/filtered pages are
// dropped by the handler, so a missing id means "not visible to this viewer").
const bookmarkedPageIds = (res: SupertestResponse): string[] =>
  res.body.userRootBookmarks.map((b: { page: { _id: string } }) => b.page._id);

interface TestRequest extends Request {
  user?: HydratedDocument<IUser>;
  crowi?: Crowi;
}

// Passthrough middleware for testing - skips authentication.
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

let app: express.Application;
let crowi: Crowi;

// Injected into req.user by middleware below.
let currentUser: HydratedDocument<IUser> | undefined;

beforeAll(async () => {
  crowi = await getInstance();
});

beforeEach(async () => {
  currentUser = undefined;

  app = express();
  app.use(express.json());

  const responseHelpers: { response: Record<string, unknown> } = {
    response: {},
  };
  addCustomFunctionToResponse(responseHelpers);
  app.use((_req, res, next) => {
    Object.assign(res, responseHelpers.response);
    next();
  });

  // Inject crowi and user into request.
  app.use((req: TestRequest, _res, next) => {
    req.crowi = crowi;
    req.user = currentUser;
    next();
  });

  // Mount the real router (same factory the production server mounts).
  const { setup } = await import('./bookmarks');
  app.use('/', setup(crowi));
});

afterEach(async () => {
  await Promise.all([
    prisma.bookmarks.deleteMany({}),
    prisma.bookmarkfolders.deleteMany({}),
    mongoose.model('Page').deleteMany({}),
    mongoose.model('User').deleteMany({}),
    mongoose.model('UserGroup').deleteMany({}),
    mongoose.model('UserGroupRelation').deleteMany({}),
  ]);

  // Config docs live in a separate collection that survives the deletes above,
  // so reset the policies these tests toggle back to their defaults (false).
  await configManager.updateConfigs(
    {
      'security:list-policy:hideRestrictedByOwner': false,
      'security:list-policy:hideRestrictedByGroup': false,
      'security:disableUserPages': false,
    },
    { skipPubsub: true },
  );
});

describe('GET /bookmarks/:userId', () => {
  describe('general behavior and edge cases', () => {
    it('returns 400 when userId is not a valid ObjectId', async () => {
      const res = await request(app).get('/not-a-valid-object-id');

      expect(res.status).toBe(400);
    });

    it('returns an empty list for a user with no bookmarks', async () => {
      const user = await seedUser('no-bookmarks');
      currentUser = user;

      const res = await request(app).get(`/${user._id.toString()}`);

      expect(res.status).toBe(200);
      expect(res.body.userRootBookmarks).toEqual([]);
    });

    it('returns a public bookmark on the owner list', async () => {
      const owner = await seedUser('owner');
      const page = await seedPage({ path: '/public-page', creator: owner });
      await seedBookmark(owner, page);
      currentUser = owner;

      const res = await request(app).get(`/${owner._id.toString()}`);

      expect(res.status).toBe(200);
      expect(bookmarkedPageIds(res)).toContain(page._id.toString());
    });

    it('returns a public bookmark when another user views the list', async () => {
      const owner = await seedUser('owner');
      const viewer = await seedUser('viewer');
      const page = await seedPage({ path: '/public-page', creator: owner });
      await seedBookmark(owner, page);
      currentUser = viewer;

      const res = await request(app).get(`/${owner._id.toString()}`);

      expect(res.status).toBe(200);
      expect(bookmarkedPageIds(res)).toContain(page._id.toString());
    });

    it('excludes a bookmark whose page no longer exists', async () => {
      const owner = await seedUser('owner');
      const deletedPage = await seedPage({ path: '/deleted', creator: owner });
      const livePage = await seedPage({ path: '/live', creator: owner });
      await seedBookmark(owner, deletedPage);
      await seedBookmark(owner, livePage);
      await mongoose.model('Page').deleteOne({ _id: deletedPage._id });
      currentUser = owner;

      const res = await request(app).get(`/${owner._id.toString()}`);

      expect(res.status).toBe(200);
      const ids = bookmarkedPageIds(res);
      // positive control: a live bookmark still comes through, so the empty
      // slot is specifically the deleted page, not a degenerate empty response.
      expect(ids).toContain(livePage._id.toString());
      expect(ids).not.toContain(deletedPage._id.toString());
    });
  });

  // GRANT_OWNER: shown to the granted user; hidden from others when the admin
  // has enabled "always hidden" (hideRestrictedByOwner = true).
  describe('owner-restricted pages (hideRestrictedByOwner = true)', () => {
    beforeEach(async () => {
      await configManager.updateConfig(
        'security:list-policy:hideRestrictedByOwner',
        true,
        { skipPubsub: true },
      );
    });

    it('hides another user owner-restricted bookmark from a viewer without access', async () => {
      const owner = await seedUser('owner');
      const viewer = await seedUser('viewer');
      const restrictedPage = await seedPage({
        path: '/owner/secret',
        creator: owner,
        grant: PageGrant.GRANT_OWNER,
        grantedUsers: [owner],
      });
      const publicPage = await seedPage({ path: '/public', creator: owner });
      await seedBookmark(owner, restrictedPage);
      await seedBookmark(owner, publicPage);
      currentUser = viewer;

      const res = await request(app).get(`/${owner._id.toString()}`);

      expect(res.status).toBe(200);
      const ids = bookmarkedPageIds(res);
      // positive control: the viewer really receives the list, so the missing
      // restricted page is a filtering decision, not an empty/failed response.
      expect(ids).toContain(publicPage._id.toString());
      expect(ids).not.toContain(restrictedPage._id.toString());
    });

    it('still shows an owner-restricted bookmark to the granted user', async () => {
      const owner = await seedUser('owner');
      const page = await seedPage({
        path: '/owner/secret',
        creator: owner,
        grant: PageGrant.GRANT_OWNER,
        grantedUsers: [owner],
      });
      await seedBookmark(owner, page);
      currentUser = owner;

      const res = await request(app).get(`/${owner._id.toString()}`);

      expect(res.status).toBe(200);
      expect(bookmarkedPageIds(res)).toContain(page._id.toString());
    });
  });

  // GRANT_USER_GROUP: shown to group members; hidden from non-members when the
  // admin has enabled "always hidden" (hideRestrictedByGroup = true).
  describe('group-restricted pages (hideRestrictedByGroup = true)', () => {
    beforeEach(async () => {
      await configManager.updateConfig(
        'security:list-policy:hideRestrictedByGroup',
        true,
        { skipPubsub: true },
      );
    });

    it('hides a group-restricted bookmark from a non-member', async () => {
      const owner = await seedUser('owner');
      const outsider = await seedUser('outsider');
      const group = await seedGroup('team');
      await addUserToGroup(group, owner);
      const restrictedPage = await seedPage({
        path: '/group/secret',
        creator: owner,
        grant: PageGrant.GRANT_USER_GROUP,
        grantedGroups: [{ item: group._id, type: 'UserGroup' }],
      });
      const publicPage = await seedPage({ path: '/public', creator: owner });
      await seedBookmark(owner, restrictedPage);
      await seedBookmark(owner, publicPage);
      currentUser = outsider;

      const res = await request(app).get(`/${owner._id.toString()}`);

      expect(res.status).toBe(200);
      const ids = bookmarkedPageIds(res);
      // positive control: the non-member still receives the list, so the missing
      // group page is a filtering decision, not an empty/failed response.
      expect(ids).toContain(publicPage._id.toString());
      expect(ids).not.toContain(restrictedPage._id.toString());
    });

    it('still shows a group-restricted bookmark to a fellow member viewing another user list', async () => {
      const owner = await seedUser('owner');
      const member = await seedUser('member');
      const group = await seedGroup('team');
      await addUserToGroup(group, owner);
      await addUserToGroup(group, member);
      const page = await seedPage({
        path: '/group/secret',
        creator: owner,
        grant: PageGrant.GRANT_USER_GROUP,
        grantedGroups: [{ item: group._id, type: 'UserGroup' }],
      });
      await seedBookmark(owner, page);
      currentUser = member;

      const res = await request(app).get(`/${owner._id.toString()}`);

      expect(res.status).toBe(200);
      expect(bookmarkedPageIds(res)).toContain(page._id.toString());
    });
  });

  // GRANT_RESTRICTED ("anyone with the link"): these pages are never listed
  // anywhere, so a bookmark is often the owner's only path back to them. They
  // stay visible on the owner's own list but are hidden from everyone else.
  describe('GRANT_RESTRICTED ("anyone with the link") pages', () => {
    it('shows the bookmark on the owner own list (isOwnList)', async () => {
      const owner = await seedUser('owner');
      const page = await seedPage({
        path: '/link-only',
        creator: owner,
        grant: PageGrant.GRANT_RESTRICTED,
      });
      await seedBookmark(owner, page);
      currentUser = owner;

      const res = await request(app).get(`/${owner._id.toString()}`);

      expect(res.status).toBe(200);
      expect(bookmarkedPageIds(res)).toContain(page._id.toString());
    });

    it('hides the bookmark from another user viewing the owner list', async () => {
      const owner = await seedUser('owner');
      const viewer = await seedUser('viewer');
      const linkOnlyPage = await seedPage({
        path: '/link-only',
        creator: owner,
        grant: PageGrant.GRANT_RESTRICTED,
      });
      const publicPage = await seedPage({ path: '/public', creator: owner });
      await seedBookmark(owner, linkOnlyPage);
      await seedBookmark(owner, publicPage);
      currentUser = viewer;

      const res = await request(app).get(`/${owner._id.toString()}`);

      expect(res.status).toBe(200);
      const ids = bookmarkedPageIds(res);
      // positive control: the viewer really receives the list, so the missing
      // link-only page is a filtering decision, not an empty/failed response.
      expect(ids).toContain(publicPage._id.toString());
      expect(ids).not.toContain(linkOnlyPage._id.toString());
    });
  });

  describe('disableUserPages = true', () => {
    beforeEach(async () => {
      await configManager.updateConfig('security:disableUserPages', true, {
        skipPubsub: true,
      });
    });

    it('excludes user pages and the users top page, keeping normal pages', async () => {
      const owner = await seedUser('owner');
      const userPage = await seedPage({ path: '/user/owner', creator: owner });
      const usersTopPage = await seedPage({ path: '/user', creator: owner });
      const normalPage = await seedPage({ path: '/normal', creator: owner });
      await seedBookmark(owner, userPage);
      await seedBookmark(owner, usersTopPage);
      await seedBookmark(owner, normalPage);
      currentUser = owner;

      const res = await request(app).get(`/${owner._id.toString()}`);

      expect(res.status).toBe(200);
      const ids = bookmarkedPageIds(res);
      expect(ids).toContain(normalPage._id.toString());
      expect(ids).not.toContain(userPage._id.toString());
      expect(ids).not.toContain(usersTopPage._id.toString());
    });
  });
});

describe('GET /bookmarks/info', () => {
  const seedOwnerOnlyPage = (
    owner: HydratedDocument<IUser>,
  ): Promise<HydratedDocument<PageDocument>> => {
    return seedPage({
      path: '/owner-only-page',
      creator: owner,
      grant: PageGrant.GRANT_OWNER,
      grantedUsers: [owner],
    });
  };

  // The whole body, so a 404 that still carried bookmark info would fail.
  const notFoundOrForbiddenBody = {
    errors: [expect.objectContaining({ code: 'notfound_or_forbidden' })],
  };

  it('returns 404 without bookmark info for a page the viewer cannot see', async () => {
    const owner = await seedUser('owner');
    const outsider = await seedUser('outsider');
    const page = await seedOwnerOnlyPage(owner);
    await seedBookmark(owner, page);
    currentUser = outsider;

    const res = await request(app).get(`/info?pageId=${page._id.toString()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(notFoundOrForbiddenBody);
  });

  it('returns 404 without bookmark info for a guest on a non-public page', async () => {
    const owner = await seedUser('owner');
    const page = await seedOwnerOnlyPage(owner);
    await seedBookmark(owner, page);
    currentUser = undefined;

    const res = await request(app).get(`/info?pageId=${page._id.toString()}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual(notFoundOrForbiddenBody);
  });

  it('responds to a nonexistent page the same way as to a forbidden one', async () => {
    const outsider = await seedUser('outsider');
    currentUser = outsider;

    const res = await request(app).get(
      `/info?pageId=${new mongoose.Types.ObjectId().toString()}`,
    );

    expect(res.status).toBe(404);
    expect(res.body).toEqual(notFoundOrForbiddenBody);
  });

  it('returns bookmark info for a non-public page the viewer can see', async () => {
    const owner = await seedUser('owner');
    const page = await seedOwnerOnlyPage(owner);
    await seedBookmark(owner, page);
    currentUser = owner;

    const res = await request(app).get(`/info?pageId=${page._id.toString()}`);

    expect(res.status).toBe(200);
    expect(res.body.sumOfBookmarks).toBe(1);
    expect(res.body.isBookmarked).toBe(true);
    expect(res.body.bookmarkedUsers.map((u: { _id: string }) => u._id)).toEqual(
      [owner._id.toString()],
    );
  });

  it('returns bookmark info for an empty page, which can be bookmarked', async () => {
    const owner = await seedUser('owner');
    const viewer = await seedUser('viewer');
    const page = await seedPage({
      path: '/empty-parent',
      creator: owner,
      isEmpty: true,
    });
    await seedBookmark(owner, page);
    currentUser = viewer;

    const res = await request(app).get(`/info?pageId=${page._id.toString()}`);

    expect(res.status).toBe(200);
    expect(res.body.sumOfBookmarks).toBe(1);
    expect(res.body.bookmarkedUsers.map((u: { _id: string }) => u._id)).toEqual(
      [owner._id.toString()],
    );
  });

  it('returns bookmark info for a public page to another user', async () => {
    const owner = await seedUser('owner');
    const viewer = await seedUser('viewer');
    const page = await seedPage({ path: '/public-page', creator: owner });
    await seedBookmark(owner, page);
    currentUser = viewer;

    const res = await request(app).get(`/info?pageId=${page._id.toString()}`);

    expect(res.status).toBe(200);
    expect(res.body.sumOfBookmarks).toBe(1);
    expect(res.body.isBookmarked).toBe(false);
    expect(res.body.bookmarkedUsers.map((u: { _id: string }) => u._id)).toEqual(
      [owner._id.toString()],
    );
  });

  it('returns bookmark info for a group-restricted page to a fellow member', async () => {
    const owner = await seedUser('owner');
    const member = await seedUser('member');
    const group = await seedGroup('team');
    await addUserToGroup(group, owner);
    await addUserToGroup(group, member);
    const page = await seedPage({
      path: '/group/secret',
      creator: owner,
      grant: PageGrant.GRANT_USER_GROUP,
      grantedGroups: [{ item: group._id, type: 'UserGroup' }],
    });
    await seedBookmark(owner, page);
    currentUser = member;

    const res = await request(app).get(`/info?pageId=${page._id.toString()}`);

    expect(res.status).toBe(200);
    expect(res.body.bookmarkedUsers.map((u: { _id: string }) => u._id)).toEqual(
      [owner._id.toString()],
    );
  });

  it('returns bookmark info for an "anyone with the link" page to another user', async () => {
    const owner = await seedUser('owner');
    const viewer = await seedUser('viewer');
    const page = await seedPage({
      path: '/link-only',
      creator: owner,
      grant: PageGrant.GRANT_RESTRICTED,
    });
    await seedBookmark(owner, page);
    currentUser = viewer;

    const res = await request(app).get(`/info?pageId=${page._id.toString()}`);

    expect(res.status).toBe(200);
    expect(res.body.bookmarkedUsers.map((u: { _id: string }) => u._id)).toEqual(
      [owner._id.toString()],
    );
  });
});
