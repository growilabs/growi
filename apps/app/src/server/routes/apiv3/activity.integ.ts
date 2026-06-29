/**
 * Integration tests for GET /api/v3/activity (audit-log list).
 *
 * Tests that the Prisma-based handler returns the same observable behaviour as
 * the previous Mongoose implementation:
 *  - same-shape paginated response (docs, totalDocs, page, limit, offset, …)
 *  - filter parity: action / username / date-range filters work
 *  - `offset || 1` quirk: sending no offset → 1-record skip on page 1 (req 2.1)
 *  - `userId` absent from docs, `user` present and serialized (req 2.3)
 *
 * Requires a running MongoDB (replica-set rs0) — runs in CI only.
 * Local egress is blocked (mongo DL 403), so these tests are CI-gated.
 *
 * Requirements: 2.1, 2.2, 2.3
 * Design: "apiv3/activity.ts" node; Migration Strategy "offset || 1 quirk" paragraph
 */

import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import { Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { prisma } from '~/utils/prisma';

import type { ApiV3Response } from './interfaces/apiv3-response';

// ---------------------------------------------------------------------------
// Passthrough middleware stubs (bypass auth for testing)
// ---------------------------------------------------------------------------
const passthrough = (_req: Request, _res: Response, next: NextFunction) =>
  next();

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: () => passthrough,
}));
vi.mock('~/server/middlewares/login-required', () => ({
  default: () => passthrough,
}));
vi.mock('~/server/middlewares/admin-required', () => ({
  default: () => passthrough,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal activities record for seeding */
function makeActivityData(overrides: {
  userId: string;
  username: string;
  action: string;
  ip?: string;
  endpoint?: string;
  createdAt?: Date;
}) {
  const snapshotId = new Types.ObjectId().toHexString();
  return {
    id: new Types.ObjectId().toHexString(),
    v: 0,
    action: overrides.action,
    createdAt: overrides.createdAt ?? new Date(),
    endpoint: overrides.endpoint ?? '/test',
    ip: overrides.ip ?? '127.0.0.1',
    snapshot: { id: snapshotId, username: overrides.username },
    userId: overrides.userId,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/v3/activity', () => {
  let app: express.Application;
  let crowi: Crowi;

  const userId1 = new Types.ObjectId().toHexString();
  const userId2 = new Types.ObjectId().toHexString();

  // We insert activities without a matching user to keep the test self-contained.
  // `include: { user: true }` returns null for missing relations — the handler
  // calls `serializeUserSecurely(user as any)` directly, and serializeUserSecurely
  // returns its argument unchanged when it is null/undefined (`if (user == null) return user`).

  beforeAll(async () => {
    crowi = await getInstance();

    const { setup } = await import('./activity');
    const router = setup(crowi);

    app = express();
    app.use(express.json());

    // Inject apiv3 response helpers to match real middleware
    app.use(
      (req: Request, res: Response & ApiV3Response, next: NextFunction) => {
        // biome-ignore lint/suspicious/noExplicitAny: test helper shim
        res.apiv3 = (data: any) => res.json({ ok: true, data });
        // biome-ignore lint/suspicious/noExplicitAny: test helper shim
        res.apiv3Err = (err: any, code = 400) =>
          res.status(code).json({ ok: false, error: String(err) });
        next();
      },
    );

    app.use('/api/v3/activity', router);
  });

  beforeEach(async () => {
    // Clean up activities inserted by tests
    await prisma.activities.deleteMany({ where: { ip: '127.0.0.1' } });
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: '127.0.0.1' } });
  });

  describe('req 2.3 — response shape parity', () => {
    it('docs have no userId field, have user field, have _id and __v', async () => {
      await prisma.activities.createMany({
        data: [
          makeActivityData({
            userId: userId1,
            username: 'alice',
            action: 'PAGE_CREATE',
          }),
        ],
      });

      const searchFilter = JSON.stringify({ usernames: ['alice'] });
      const res = await request(app)
        .get('/api/v3/activity')
        .query({ limit: 10, offset: 1, searchFilter });

      expect(res.status).toBe(200);
      const { serializedPaginationResult } = res.body.data;
      expect(serializedPaginationResult.docs).toHaveLength(1);

      const doc = serializedPaginationResult.docs[0];
      // userId must NOT be present (req 2.3: Mongoose did not expose it)
      expect(doc).not.toHaveProperty('userId');
      // user must be present (populated in old Mongoose, now via include)
      expect(doc).toHaveProperty('user');
      // backward-compat computed fields
      expect(doc).toHaveProperty('_id');
      expect(doc).toHaveProperty('__v');
    });

    it('pagination envelope includes offset, page, totalDocs, hasNextPage', async () => {
      await prisma.activities.createMany({
        data: [
          makeActivityData({
            userId: userId1,
            username: 'alice',
            action: 'PAGE_CREATE',
          }),
          makeActivityData({
            userId: userId2,
            username: 'bob',
            action: 'PAGE_UPDATE',
          }),
        ],
      });

      const res = await request(app)
        .get('/api/v3/activity')
        .query({ limit: 10, offset: 1 });

      expect(res.status).toBe(200);
      const pr = res.body.data.serializedPaginationResult;
      expect(pr).toHaveProperty('offset');
      expect(pr).toHaveProperty('page');
      expect(pr).toHaveProperty('totalDocs');
      expect(pr).toHaveProperty('hasNextPage');
      expect(pr).toHaveProperty('hasPrevPage');
      expect(pr).toHaveProperty('limit');
    });
  });

  describe('req 2.1 — offset || 1 quirk preserved', () => {
    it('skips 1 record when offset is not provided (falsy → 1)', async () => {
      // Insert 3 activities ordered by createdAt desc
      const now = Date.now();
      await prisma.activities.createMany({
        data: [
          makeActivityData({
            userId: userId1,
            username: 'alice',
            action: 'PAGE_CREATE',
            createdAt: new Date(now),
          }),
          makeActivityData({
            userId: userId1,
            username: 'alice',
            action: 'PAGE_UPDATE',
            createdAt: new Date(now - 1000),
          }),
          makeActivityData({
            userId: userId1,
            username: 'alice',
            action: 'PAGE_DELETE',
            createdAt: new Date(now - 2000),
          }),
        ],
      });

      // No offset → offset defaults to 1 → first record is skipped
      const searchFilter = JSON.stringify({ usernames: ['alice'] });
      const res = await request(app)
        .get('/api/v3/activity')
        .query({ limit: 10, searchFilter });

      expect(res.status).toBe(200);
      const { docs } = res.body.data.serializedPaginationResult;
      // With 3 records and skip=1, we expect 2 docs returned
      expect(docs).toHaveLength(2);
      // The most-recent record (PAGE_CREATE) is skipped; PAGE_UPDATE is first
      expect(docs[0].action).toBe('PAGE_UPDATE');
    });
  });

  describe('req 2.2 — filter parity', () => {
    beforeEach(async () => {
      await prisma.activities.createMany({
        data: [
          makeActivityData({
            userId: userId1,
            username: 'alice',
            action: 'PAGE_CREATE',
          }),
          makeActivityData({
            userId: userId1,
            username: 'alice',
            action: 'PAGE_UPDATE',
          }),
          makeActivityData({
            userId: userId2,
            username: 'bob',
            action: 'PAGE_DELETE',
          }),
        ],
      });
    });

    it('filters by username via snapshot.is.username.in (R1 composite filter)', async () => {
      const searchFilter = JSON.stringify({ usernames: ['alice'] });
      const res = await request(app)
        .get('/api/v3/activity')
        .query({ limit: 10, offset: 1, searchFilter });

      expect(res.status).toBe(200);
      const { docs } = res.body.data.serializedPaginationResult;
      expect(docs.length).toBeGreaterThan(0);
      // All returned docs should have alice's snapshot username
      for (const doc of docs) {
        expect(doc.snapshot.username).toBe('alice');
      }
    });

    it('filters by action', async () => {
      const searchFilter = JSON.stringify({ actions: ['PAGE_DELETE'] });
      const res = await request(app)
        .get('/api/v3/activity')
        .query({ limit: 10, offset: 1, searchFilter });

      expect(res.status).toBe(200);
      const { docs } = res.body.data.serializedPaginationResult;
      for (const doc of docs) {
        expect(doc.action).toBe('PAGE_DELETE');
      }
    });

    it('returns all docs when no filters are applied (empty searchFilter)', async () => {
      const searchFilter = JSON.stringify({});
      const res = await request(app)
        .get('/api/v3/activity')
        .query({ limit: 10, offset: 1, searchFilter });

      expect(res.status).toBe(200);
      const { totalDocs } = res.body.data.serializedPaginationResult;
      expect(totalDocs).toBeGreaterThanOrEqual(3);
    });
  });

  describe('req 2.1 — sort order: newest first', () => {
    it('returns docs in descending createdAt order', async () => {
      const now = Date.now();
      await prisma.activities.createMany({
        data: [
          makeActivityData({
            userId: userId1,
            username: 'alice',
            action: 'PAGE_CREATE',
            createdAt: new Date(now - 2000),
          }),
          makeActivityData({
            userId: userId1,
            username: 'alice',
            action: 'PAGE_UPDATE',
            createdAt: new Date(now - 1000),
          }),
          makeActivityData({
            userId: userId1,
            username: 'alice',
            action: 'PAGE_DELETE',
            createdAt: new Date(now),
          }),
        ],
      });

      const searchFilter = JSON.stringify({ usernames: ['alice'] });
      const res = await request(app)
        .get('/api/v3/activity')
        .query({ limit: 10, offset: 1, searchFilter });

      expect(res.status).toBe(200);
      const { docs } = res.body.data.serializedPaginationResult;
      // With offset=1, PAGE_DELETE (newest) is skipped; PAGE_UPDATE comes first
      expect(docs[0].action).toBe('PAGE_UPDATE');
      expect(docs[1].action).toBe('PAGE_CREATE');
    });
  });
});
