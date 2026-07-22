import type { IUser } from '@growi/core';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import mongoose, { type HydratedDocument } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import type { BookmarkDocument, BookmarkModel } from '~/server/models/bookmark';
import type {
  BookmarkFolderDocument,
  BookmarkFolderModel,
} from '~/server/models/bookmark-folder';

import type { ApiV3Response } from './interfaces/apiv3-response';

const getBookmarkFolderModel = () =>
  mongoose.model<BookmarkFolderDocument, BookmarkFolderModel>('BookmarkFolder');

const seedUser = async (username: string): Promise<HydratedDocument<IUser>> => {
  const User = mongoose.model<IUser>('User');
  const [user] = await User.insertMany([
    { name: username, username, email: `${username}@example.com` },
  ]);
  return user;
};

const seedFolder = (
  name: string,
  owner: HydratedDocument<IUser>,
  parent?: HydratedDocument<BookmarkFolderDocument>,
): Promise<HydratedDocument<BookmarkFolderDocument>> => {
  return getBookmarkFolderModel().create({
    name,
    owner: owner._id,
    parent: parent?._id,
  });
};

const seedBookmark = (
  user: HydratedDocument<IUser>,
  pageId: mongoose.Types.ObjectId,
): Promise<HydratedDocument<BookmarkDocument>> => {
  const Bookmark = mongoose.model<
    HydratedDocument<BookmarkDocument>,
    BookmarkModel
  >('Bookmark');
  return Bookmark.create({ user: user._id, page: pageId });
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

describe('bookmark-folder apiv3 routes', () => {
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
        // Expose the stable error code (ErrorV3.code) so tests can assert on it
        // rather than the human-readable message.
        const code =
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          typeof error.code === 'string'
            ? error.code
            : undefined;
        return res.status(status).json({ error: message, code });
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
    const routerModule = await import('./bookmark-folder');
    const createRouter = ((routerModule as { default?: unknown }).default ??
      routerModule) as (c: Crowi) => express.Router;
    app.use('/', createRouter(crowi));
  });

  afterEach(async () => {
    await Promise.all([
      mongoose.model('Bookmark').deleteMany({}),
      mongoose.model('BookmarkFolder').deleteMany({}),
      mongoose.model('User').deleteMany({}),
    ]);
  });

  describe('PUT / (update bookmark folder)', () => {
    describe('bookmarkFolderId validation', () => {
      // The shared validator declares bookmarkFolderId as `.optional()`, so an
      // absent value skips express-validator entirely. Only the in-handler guard
      // rejects it — without that guard this request would reach findById(undefined)
      // and return 404. Asserting the guard's own error code (not the validator's
      // shape) pins the guard as the thing that rejected the request; this is the
      // one branch where the guard's behavior is uniquely observable at runtime.
      it('returns 400 when bookmarkFolderId is missing', async () => {
        currentUser = await seedUser('owner');

        const res = await request(app).put('/').send({ name: 'renamed' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('invalid_bookmark_folder_id');
      });

      // Black-box input-rejection contract: a query-operator object is rejected
      // with 400. Note the shared validator (`.isMongoId()`) rejects a *present*
      // object before the inline guard runs, so this asserts the endpoint's
      // contract, not the guard specifically (no present value passes isMongoId
      // yet fails the guard).
      it('returns 400 when bookmarkFolderId is a query-operator object', async () => {
        currentUser = await seedUser('owner');

        const res = await request(app)
          .put('/')
          .send({ name: 'renamed', bookmarkFolderId: { $gt: '' } });

        expect(res.status).toBe(400);
      });
    });

    // Black-box input-rejection contract (validator-enforced, as above).
    it('returns 400 when parent is a query-operator object', async () => {
      const owner = await seedUser('owner');
      const folder = await seedFolder('folder', owner);
      currentUser = owner;

      const res = await request(app)
        .put('/')
        .send({
          name: 'renamed',
          bookmarkFolderId: folder._id.toString(),
          parent: { $gt: '' },
        });

      expect(res.status).toBe(400);
    });

    // Regression guard: the parent lookup/ownership checks must stay inside an
    // `if (parent != null)` block. A rename with no parent must succeed, not 404.
    it('renames a folder when no parent is given', async () => {
      const owner = await seedUser('owner');
      const folder = await seedFolder('before', owner);
      currentUser = owner;

      const res = await request(app)
        .put('/')
        .send({ name: 'after', bookmarkFolderId: folder._id.toString() });

      expect(res.status).toBe(200);
      expect(res.body.bookmarkFolder.name).toBe('after');
    });

    // Regression guard: a *valid* parent owned by the user must be accepted.
    // (An inverted validity check would reject the valid parent with 400.)
    it('moves a folder under a valid parent owned by the user', async () => {
      const owner = await seedUser('owner');
      const child = await seedFolder('child', owner);
      const parent = await seedFolder('parent', owner);
      currentUser = owner;

      const res = await request(app).put('/').send({
        name: 'child',
        bookmarkFolderId: child._id.toString(),
        parent: parent._id.toString(),
        childFolder: [],
      });

      expect(res.status).toBe(200);
      expect(res.body.bookmarkFolder.parent).toBe(parent._id.toString());
    });

    it('returns 403 when the folder is owned by another user', async () => {
      const owner = await seedUser('owner');
      const other = await seedUser('other');
      const folder = await seedFolder('folder', owner);
      currentUser = other;

      const res = await request(app)
        .put('/')
        .send({ name: 'renamed', bookmarkFolderId: folder._id.toString() });

      expect(res.status).toBe(403);
    });

    it('returns 404 when the folder does not exist', async () => {
      currentUser = await seedUser('owner');
      const missingId = new mongoose.Types.ObjectId().toString();

      const res = await request(app)
        .put('/')
        .send({ name: 'renamed', bookmarkFolderId: missingId });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /add-bookmark-to-folder', () => {
    // Black-box input-rejection contract (validator-enforced, as in PUT above).
    it('returns 400 when folderId is a query-operator object', async () => {
      const owner = await seedUser('owner');
      currentUser = owner;
      const pageId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .post('/add-bookmark-to-folder')
        .send({ pageId: pageId.toString(), folderId: { $gt: '' } });

      expect(res.status).toBe(400);
    });

    // Regression guard: folderId is genuinely optional (bookmark at root). The
    // folder lookup must stay inside `if (folderId != null)` — otherwise an
    // omitted folderId hits findById(null) and 404s. The handler returns a null
    // bookmarkFolder for the root path, so assert that to confirm the root path
    // was taken (not just that the request avoided a 4xx).
    it('adds a bookmark at root when folderId is omitted', async () => {
      const owner = await seedUser('owner');
      currentUser = owner;
      const pageId = new mongoose.Types.ObjectId();
      await seedBookmark(owner, pageId);

      const res = await request(app)
        .post('/add-bookmark-to-folder')
        .send({ pageId: pageId.toString() });

      expect(res.status).toBe(200);
      expect(res.body.bookmarkFolder).toBeNull();
    });

    it('adds a bookmark to a folder owned by the user', async () => {
      const owner = await seedUser('owner');
      const folder = await seedFolder('folder', owner);
      currentUser = owner;
      const pageId = new mongoose.Types.ObjectId();
      const bookmark = await seedBookmark(owner, pageId);

      const res = await request(app)
        .post('/add-bookmark-to-folder')
        .send({ pageId: pageId.toString(), folderId: folder._id.toString() });

      expect(res.status).toBe(200);
      // Assert the effect, not just the status: the bookmark is persisted into
      // the target folder.
      const updated = await getBookmarkFolderModel().findById(folder._id);
      expect(updated?.bookmarks?.map((b) => b.toString())).toContain(
        bookmark._id.toString(),
      );
    });

    it('returns 403 when the folder is owned by another user', async () => {
      const owner = await seedUser('owner');
      const other = await seedUser('other');
      const folder = await seedFolder('folder', owner);
      currentUser = other;
      const pageId = new mongoose.Types.ObjectId();
      await seedBookmark(other, pageId);

      const res = await request(app)
        .post('/add-bookmark-to-folder')
        .send({ pageId: pageId.toString(), folderId: folder._id.toString() });

      expect(res.status).toBe(403);
    });
  });
});
