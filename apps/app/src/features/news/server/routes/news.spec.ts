import type { IUserHasId } from '@growi/core';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

// Hoisted mocks
const mocks = vi.hoisted(() => {
  const listForUser = vi.fn();
  const getUnreadCount = vi.fn();
  const markRead = vi.fn();
  const markAllRead = vi.fn();
  return {
    NewsService: vi.fn(() => ({
      listForUser,
      getUnreadCount,
      markRead,
      markAllRead,
    })),
    listForUser,
    getUnreadCount,
    markRead,
    markAllRead,
  };
});

vi.mock('../services/news-service', () => ({
  NewsService: mocks.NewsService,
}));

// Middleware mocks - bypass auth
vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

vi.mock('~/server/middlewares/login-required', () => ({
  default:
    () =>
    (
      req: express.Request & { user?: IUserHasId },
      _res: unknown,
      next: () => void,
    ) => {
      // Attach a mock user if not set
      if (!req.user) {
        req.user = {
          _id: new mongoose.Types.ObjectId(),
          admin: false,
        } as unknown as IUserHasId;
      }
      next();
    },
}));

import { createNewsRouter } from './news';

const buildApp = (userOverride?: Partial<IUserHasId>) => {
  const app = express();
  app.use(express.json());
  app.use((req: express.Request & { user?: IUserHasId }, _res, next) => {
    req.user = {
      _id: new mongoose.Types.ObjectId(),
      admin: false,
      ...userOverride,
    } as unknown as IUserHasId;
    next();
  });
  app.use('/apiv3/news', createNewsRouter());
  return app;
};

describe('News API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /apiv3/news/list', () => {
    test('should return news list with default params', async () => {
      const mockResult = {
        docs: [],
        totalDocs: 0,
        limit: 10,
        offset: 0,
        page: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
        nextPage: null,
        prevPage: null,
        pagingCounter: 1,
      };
      mocks.listForUser.mockResolvedValue(mockResult);

      const app = buildApp();
      const res = await request(app).get('/apiv3/news/list');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ docs: [], totalDocs: 0 });
      expect(mocks.listForUser).toHaveBeenCalledWith(
        expect.anything(),
        ['general'],
        expect.objectContaining({ limit: 10, offset: 0 }),
      );
    });

    test('should pass admin roles for admin user', async () => {
      mocks.listForUser.mockResolvedValue({
        docs: [],
        totalDocs: 0,
        limit: 10,
        offset: 0,
        page: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
        nextPage: null,
        prevPage: null,
        pagingCounter: 1,
      });

      const app = buildApp({ admin: true });
      await request(app).get('/apiv3/news/list');

      expect(mocks.listForUser).toHaveBeenCalledWith(
        expect.anything(),
        ['admin'],
        expect.any(Object),
      );
    });

    test('should silently cap limit at 100 when caller exceeds the upper bound', async () => {
      mocks.listForUser.mockResolvedValue({
        docs: [],
        totalDocs: 0,
        limit: 100,
        offset: 0,
        page: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
        nextPage: null,
        prevPage: null,
        pagingCounter: 1,
      });

      const app = buildApp();
      await request(app).get('/apiv3/news/list?limit=99999');

      expect(mocks.listForUser).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Array),
        expect.objectContaining({ limit: 100 }),
      );
    });

    test('should fall back to default limit when caller passes a non-numeric value', async () => {
      mocks.listForUser.mockResolvedValue({
        docs: [],
        totalDocs: 0,
        limit: 10,
        offset: 0,
        page: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
        nextPage: null,
        prevPage: null,
        pagingCounter: 1,
      });

      const app = buildApp();
      await request(app).get('/apiv3/news/list?limit=abc');

      expect(mocks.listForUser).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Array),
        expect.objectContaining({ limit: 10 }),
      );
    });

    test('should clamp limit up to 1 when caller passes a negative value', async () => {
      mocks.listForUser.mockResolvedValue({
        docs: [],
        totalDocs: 0,
        limit: 1,
        offset: 0,
        page: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
        nextPage: null,
        prevPage: null,
        pagingCounter: 1,
      });

      const app = buildApp();
      await request(app).get('/apiv3/news/list?limit=-5');

      expect(mocks.listForUser).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Array),
        expect.objectContaining({ limit: 1 }),
      );
    });

    test('should pass onlyUnread=true when query param is set', async () => {
      mocks.listForUser.mockResolvedValue({
        docs: [],
        totalDocs: 0,
        limit: 10,
        offset: 0,
        page: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
        nextPage: null,
        prevPage: null,
        pagingCounter: 1,
      });

      const app = buildApp();
      await request(app).get('/apiv3/news/list?onlyUnread=true');

      expect(mocks.listForUser).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Array),
        expect.objectContaining({ onlyUnread: true }),
      );
    });
  });

  describe('GET /apiv3/news/unread-count', () => {
    test('should return unread count', async () => {
      mocks.getUnreadCount.mockResolvedValue(5);

      const app = buildApp();
      const res = await request(app).get('/apiv3/news/unread-count');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ count: 5 });
    });
  });

  describe('POST /apiv3/news/mark-read', () => {
    test('should mark a news item as read', async () => {
      mocks.markRead.mockResolvedValue(undefined);

      const newsItemId = new mongoose.Types.ObjectId().toString();
      const app = buildApp();
      const res = await request(app)
        .post('/apiv3/news/mark-read')
        .send({ newsItemId });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mocks.markRead).toHaveBeenCalled();
    });

    test('should return 400 for invalid newsItemId', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/apiv3/news/mark-read')
        .send({ newsItemId: 'invalid-id' });

      expect(res.status).toBe(400);
      expect(mocks.markRead).not.toHaveBeenCalled();
    });

    test('should return 400 when newsItemId is missing', async () => {
      const app = buildApp();
      const res = await request(app).post('/apiv3/news/mark-read').send({});

      expect(res.status).toBe(400);
    });
  });

  describe('POST /apiv3/news/mark-all-read', () => {
    test('should mark all news as read', async () => {
      mocks.markAllRead.mockResolvedValue(undefined);

      const app = buildApp();
      const res = await request(app).post('/apiv3/news/mark-all-read');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mocks.markAllRead).toHaveBeenCalled();
    });
  });
});
