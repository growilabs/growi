import type { IUser } from '@growi/core';
import { SCOPE } from '@growi/core/dist/interfaces';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import mongoose, { type HydratedDocument } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { AccessToken } from '~/server/models/access-token';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { prisma } from '~/utils/prisma';

import { SEARCH_HISTORY_KEYWORD_MAX_LENGTH } from '../../../utils/search-history-keyword';
import { createSearchHistoryRouter } from '.';

const WORKER_ID = process.env.VITEST_WORKER_ID ?? '1';

describe('search-history routes (integration)', () => {
  let crowi: Crowi;
  let app: express.Express;
  let user: HydratedDocument<IUser>;
  let otherUser: HydratedDocument<IUser>;
  let readToken: string;
  let writeToken: string;

  const bearer = (token: string) => `Bearer ${token}`;

  beforeAll(async () => {
    crowi = await getInstance();

    const User = mongoose.model<IUser>('User');
    const names = [`sh-route-${WORKER_ID}`, `sh-route-other-${WORKER_ID}`];
    await User.deleteMany({ username: { $in: names } });
    [user, otherUser] = await Promise.all(
      names.map((name) =>
        User.create({ name, username: name, email: `${name}@example.com` }),
      ),
    );

    const oneDayLater = new Date(Date.now() + 1000 * 60 * 60 * 24);
    readToken = (
      await AccessToken.generateToken(user._id, oneDayLater, [
        SCOPE.READ.FEATURES.PAGE,
      ])
    ).token;
    writeToken = (
      await AccessToken.generateToken(user._id, oneDayLater, [
        SCOPE.WRITE.FEATURES.PAGE,
      ])
    ).token;

    app = express();
    app.use(express.json());
    app.use((_req: Request, res: Response, next: NextFunction) => {
      (res as ApiV3Response).apiv3 = (body: unknown, status = 200) =>
        res.status(status).json(body);
      (res as ApiV3Response).apiv3Err = (err: unknown, status = 400) => {
        const errors = Array.isArray(err) ? err : [err];
        return res.status(status).json({ errors });
      };
      next();
    });
    app.use('/search-history', createSearchHistoryRouter(crowi));
  }, 60_000);

  afterAll(async () => {
    await AccessToken.deleteAllTokensByUserId(user._id);
    await prisma.searchhistories.deleteMany({
      where: {
        userId: { in: [user._id.toString(), otherUser._id.toString()] },
      },
    });
    await mongoose
      .model<IUser>('User')
      .deleteMany({ _id: { $in: [user._id, otherUser._id] } });
  });

  beforeEach(async () => {
    await prisma.searchhistories.deleteMany({
      where: {
        userId: { in: [user._id.toString(), otherUser._id.toString()] },
      },
    });
  });

  describe('unauthenticated requests', () => {
    it('rejects GET', async () => {
      const res = await request(app).get('/search-history');
      expect(res.status).not.toBe(200);
      expect(res.body.searchHistories).toBeUndefined();
    });

    it('rejects POST and records nothing', async () => {
      const res = await request(app)
        .post('/search-history')
        .send({ keyword: 'anon' });
      expect(res.status).not.toBe(200);
      expect(
        await prisma.searchhistories.count({ where: { keyword: 'anon' } }),
      ).toBe(0);
    });
  });

  describe('GET /search-history', () => {
    it('returns an empty list when the user has no history', async () => {
      const res = await request(app)
        .get('/search-history')
        .set('Authorization', bearer(readToken));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ searchHistories: [] });
    });

    it("returns only the caller's history, newest first, without the owner", async () => {
      const userId = user._id.toString();
      await prisma.searchhistories.createMany({
        data: [
          { userId, keyword: 'old', lastSearchedAt: new Date('2026-01-01') },
          { userId, keyword: 'new', lastSearchedAt: new Date('2026-03-01') },
          {
            userId: otherUser._id.toString(),
            keyword: 'theirs',
            lastSearchedAt: new Date('2026-04-01'),
          },
        ],
      });

      const res = await request(app)
        .get('/search-history')
        .set('Authorization', bearer(readToken));

      expect(res.status).toBe(200);
      expect(
        res.body.searchHistories.map((h: { keyword: string }) => h.keyword),
      ).toEqual(['new', 'old']);
      for (const h of res.body.searchHistories) {
        expect(Object.keys(h).sort()).toEqual([
          '_id',
          'keyword',
          'lastSearchedAt',
        ]);
      }
    });
  });

  describe('POST /search-history', () => {
    it('records the keyword and answers with the same shape as a list item', async () => {
      const res = await request(app)
        .post('/search-history')
        .set('Authorization', bearer(writeToken))
        .send({ keyword: '  hello  ' });

      expect(res.status).toBe(200);
      expect(Object.keys(res.body.searchHistory).sort()).toEqual([
        '_id',
        'keyword',
        'lastSearchedAt',
      ]);
      expect(res.body.searchHistory.keyword).toBe('hello');

      const stored = await prisma.searchhistories.findMany({
        where: { userId: user._id.toString() },
      });
      expect(stored.map((s) => s.keyword)).toEqual(['hello']);
    });

    it('ignores a userId in the body and records for the caller', async () => {
      await request(app)
        .post('/search-history')
        .set('Authorization', bearer(writeToken))
        .send({ keyword: 'mine', userId: otherUser._id.toString() });

      expect(
        await prisma.searchhistories.count({
          where: { userId: otherUser._id.toString() },
        }),
      ).toBe(0);
      expect(
        await prisma.searchhistories.count({
          where: { userId: user._id.toString() },
        }),
      ).toBe(1);
    });

    it.each([
      ['an empty keyword', ''],
      ['a blank keyword', '   '],
      [
        'a keyword over the max length',
        'a'.repeat(SEARCH_HISTORY_KEYWORD_MAX_LENGTH + 1),
      ],
      ['a non-string keyword', 123],
      ['a missing keyword', undefined],
    ])('responds 400 for %s', async (_label, keyword) => {
      const res = await request(app)
        .post('/search-history')
        .set('Authorization', bearer(writeToken))
        .send({ keyword });
      expect(res.status).toBe(400);
    });
  });

  describe('token scopes', () => {
    it('allows GET with a page read scope token', async () => {
      const res = await request(app)
        .get('/search-history')
        .set('Authorization', bearer(readToken));
      expect(res.status).toBe(200);
    });

    it('rejects POST with a page read scope token', async () => {
      const res = await request(app)
        .post('/search-history')
        .set('Authorization', bearer(readToken))
        .send({ keyword: 'x' });
      expect(res.status).not.toBe(200);
      expect(
        await prisma.searchhistories.count({ where: { keyword: 'x' } }),
      ).toBe(0);
    });

    it('allows POST with a page write scope token', async () => {
      const res = await request(app)
        .post('/search-history')
        .set('Authorization', bearer(writeToken))
        .send({ keyword: 'x' });
      expect(res.status).toBe(200);
    });
  });
});
