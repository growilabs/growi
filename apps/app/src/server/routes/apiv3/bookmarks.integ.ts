import { type IUser, PageGrant } from '@growi/core';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import mongoose, { type HydratedDocument, type Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { BookmarkDocument, BookmarkModel } from '~/server/models/bookmark';
import type { PageDocument, PageModel } from '~/server/models/page';

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
    ]);
  });
});
