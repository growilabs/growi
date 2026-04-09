/**
 * Integration tests for News API
 * Requires MongoDB connection (app-integration test environment)
 */
import type { IUserHasId } from '@growi/core';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

import { NewsItem } from '../models/news-item';
import { NewsReadStatus } from '../models/news-read-status';
import { createNewsRouter } from './news';

const buildApp = (userOverride: Partial<IUserHasId> = {}) => {
  const userId = new mongoose.Types.ObjectId();
  const app = express();
  app.use(express.json());
  app.use((req: express.Request & { user?: IUserHasId }, _res, next) => {
    req.user = {
      _id: userId,
      admin: false,
      ...userOverride,
    } as unknown as IUserHasId;
    next();
  });
  app.use('/apiv3/news', createNewsRouter());
  return { app, userId };
};

describe('News API Integration', () => {
  beforeEach(async () => {
    await NewsItem.deleteMany({});
    await NewsReadStatus.deleteMany({});
  });

  describe('GET /apiv3/news/list', () => {
    test('should return empty list when no news', async () => {
      const { app } = buildApp();
      const res = await request(app).get('/apiv3/news/list');
      expect(res.status).toBe(200);
      expect(res.body.docs).toEqual([]);
      expect(res.body.totalDocs).toBe(0);
    });

    test('should return news filtered by role', async () => {
      const now = new Date();
      await NewsItem.insertMany([
        {
          externalId: 'admin-only',
          title: { ja_JP: '管理者向け' },
          publishedAt: now,
          fetchedAt: now,
          conditions: { targetRoles: ['admin'] },
        },
        {
          externalId: 'all-users',
          title: { ja_JP: '全ユーザー向け' },
          publishedAt: now,
          fetchedAt: now,
        },
      ]);

      // General user should only see all-users item
      const { app } = buildApp({ admin: false });
      const res = await request(app).get('/apiv3/news/list');
      expect(res.status).toBe(200);
      expect(res.body.docs).toHaveLength(1);
      expect(res.body.docs[0].externalId).toBe('all-users');
    });

    test('admin user should see admin-only items', async () => {
      const now = new Date();
      await NewsItem.insertMany([
        {
          externalId: 'admin-only',
          title: { ja_JP: '管理者向け' },
          publishedAt: now,
          fetchedAt: now,
          conditions: { targetRoles: ['admin'] },
        },
        {
          externalId: 'all-users',
          title: { ja_JP: '全ユーザー向け' },
          publishedAt: now,
          fetchedAt: now,
        },
      ]);

      const { app } = buildApp({ admin: true });
      const res = await request(app).get('/apiv3/news/list');
      expect(res.status).toBe(200);
      expect(res.body.docs).toHaveLength(2);
    });
  });

  describe('POST /apiv3/news/mark-read', () => {
    test('should mark an item as read', async () => {
      const now = new Date();
      const item = await NewsItem.create({
        externalId: 'test-001',
        title: { ja_JP: 'テスト' },
        publishedAt: now,
        fetchedAt: now,
      });

      const { app, userId } = buildApp();
      const res = await request(app)
        .post('/apiv3/news/mark-read')
        .send({ newsItemId: item._id.toString() });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });

      const status = await NewsReadStatus.findOne({
        userId,
        newsItemId: item._id,
      });
      expect(status).not.toBeNull();
    });

    test('should be idempotent (second call does not error)', async () => {
      const now = new Date();
      const item = await NewsItem.create({
        externalId: 'test-002',
        title: { ja_JP: 'テスト2' },
        publishedAt: now,
        fetchedAt: now,
      });

      const { app } = buildApp();
      await request(app)
        .post('/apiv3/news/mark-read')
        .send({ newsItemId: item._id.toString() });
      const res2 = await request(app)
        .post('/apiv3/news/mark-read')
        .send({ newsItemId: item._id.toString() });

      expect(res2.status).toBe(200);
    });

    test('should return 400 for invalid newsItemId', async () => {
      const { app } = buildApp();
      const res = await request(app)
        .post('/apiv3/news/mark-read')
        .send({ newsItemId: 'not-an-objectid' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /apiv3/news/unread-count', () => {
    test('should return 0 after mark-all-read', async () => {
      const now = new Date();
      await NewsItem.insertMany([
        {
          externalId: 'n1',
          title: { ja_JP: 'item 1' },
          publishedAt: now,
          fetchedAt: now,
        },
        {
          externalId: 'n2',
          title: { ja_JP: 'item 2' },
          publishedAt: now,
          fetchedAt: now,
        },
      ]);

      const { app } = buildApp();
      await request(app).post('/apiv3/news/mark-all-read');
      const res = await request(app).get('/apiv3/news/unread-count');

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(0);
    });
  });
});
