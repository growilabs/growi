import { type IUser, PageGrant } from '@growi/core';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import mongoose, { type HydratedDocument, type Types } from 'mongoose';
import request, { type Response as SupertestResponse } from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { BookmarkDocument, BookmarkModel } from '~/server/models/bookmark';
import type { PageDocument, PageModel } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';

import type { ApiV3Response } from './interfaces/apiv3-response';

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
    },
  ]);
  return page;
};

const seedBookmark = (
  user: HydratedDocument<IUser>,
  page: HydratedDocument<PageDocument>,
): Promise<HydratedDocument<BookmarkDocument>> => {
  const Bookmark = mongoose.model<
    HydratedDocument<BookmarkDocument>,
    BookmarkModel
  >('Bookmark');
  return Bookmark.create({ user: user._id, page: page._id });
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

describe('GET /bookmarks/:userId', () => {
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

    // Re-create the apiv3 response helpers.
    app.use((_req, res: ApiV3Response, next) => {
      res.apiv3 = (data: unknown) => res.json(data);
      res.apiv3Err = (error: unknown, statusCode?: number) => {
        const status = statusCode ?? (Array.isArray(error) ? 400 : 500);
        const message =
          typeof error === 'object' &&
          error !== null &&
          'message' in error &&
          typeof error.message === 'string'
            ? error.message
            : String(error);
        return res.status(status).json({ error: message });
      };
      next();
    });

    // Inject crowi and user into request.
    app.use((req: TestRequest, _res, next) => {
      req.crowi = crowi;
      req.user = currentUser;
      next();
    });

    // Mount the real router (same factory the production server mounts).
    const bookmarksModule = await import('./bookmarks');
    const createBookmarksRouter = ((bookmarksModule as { default?: unknown })
      .default ?? bookmarksModule) as (c: Crowi) => express.Router;
    app.use('/', createBookmarksRouter(crowi));
  });

  afterEach(async () => {
    await Promise.all([
      mongoose.model('Bookmark').deleteMany({}),
      mongoose.model('BookmarkFolder').deleteMany({}),
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
