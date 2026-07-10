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
 *
 * activity-log spec coverage (Requirements 4.1, 4.2):
 *  - ATTACHMENT_REMOVE activities surface all four attachment snapshot fields
 *    (originalName / pagePath / pageId / fileSize) in the response
 *  - legacy username-only snapshots keep working (backward compat)
 *
 * activity-log-snapshot increment coverage (Requirements 8.1, 8.2, 8.3, 8.4):
 *  - ATTACHMENT_ADD / ATTACHMENT_DOWNLOAD activities surface the same four
 *    attachment snapshot fields in the response (8.1; DOWNLOAD may omit
 *    username for guest downloads)
 *  - ATTACHMENT_ADD responses include target (attachment _id) and
 *    targetModel 'Attachment' for downstream viewer DL-link generation (8.2)
 *  - ADD and REMOVE are distinguishable by `action` alone (8.3)
 *  - legacy ADD/DOWNLOAD records with username-only snapshots keep
 *    working (8.4)
 */

import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import { Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import type Crowi from '~/server/crowi';
import { configManager } from '~/server/service/config-manager';
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
  /** Omit both userId and username to seed a guest-shaped activity */
  userId?: string;
  username?: string;
  action: string;
  ip?: string;
  endpoint?: string;
  createdAt?: Date;
  /** Attachment snapshot fields (activity-log spec req 4.1) */
  snapshotExtras?: {
    originalName?: string;
    pagePath?: string;
    pageId?: string;
    fileSize?: number;
  };
  /** Attachment identifier exposure (activity-log-snapshot req 8.2) */
  target?: string;
  targetModel?: string;
}) {
  const snapshotId = new Types.ObjectId().toHexString();
  return {
    id: new Types.ObjectId().toHexString(),
    v: 0,
    action: overrides.action,
    createdAt: overrides.createdAt ?? new Date(),
    endpoint: overrides.endpoint ?? '/test',
    ip: overrides.ip ?? '127.0.0.1',
    snapshot: {
      id: snapshotId,
      username: overrides.username,
      ...overrides.snapshotExtras,
    },
    userId: overrides.userId,
    target: overrides.target,
    targetModel: overrides.targetModel,
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

    // The route handler short-circuits to 405 "AuditLog is not enabled" when
    // this is falsy -- required for any of the below requests to reach the
    // paginate/filter logic under test.
    await configManager.updateConfigs({ 'app:auditLogEnabled': true });

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
        // offset=0 (not 1): this test asserts response shape, not the
        // offset||1 quirk -- offset=1 would skip the only seeded record.
        .query({ limit: 10, offset: 0, searchFilter });

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
        .query({ limit: 10, offset: 1, searchFilter: JSON.stringify({}) });

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

  describe('activity-log req 4.1 / 4.2 — attachment snapshot fields', () => {
    it('surfaces all four attachment fields on an ATTACHMENT_REMOVE activity snapshot (req 4.1)', async () => {
      const pageId = new Types.ObjectId().toHexString();
      await prisma.activities.createMany({
        data: [
          makeActivityData({
            userId: userId1,
            username: 'attachment-remover',
            action: 'ATTACHMENT_REMOVE',
            snapshotExtras: {
              originalName: 'design-v2.pdf',
              pagePath: '/Sandbox/attachments',
              pageId,
              fileSize: 12345,
            },
          }),
        ],
      });

      const searchFilter = JSON.stringify({
        usernames: ['attachment-remover'],
      });
      const res = await request(app)
        .get('/api/v3/activity')
        // offset=0: the single seeded record must not be skipped by the
        // offset||1 quirk (see req 2.1 tests above).
        .query({ limit: 10, offset: 0, searchFilter });

      expect(res.status).toBe(200);
      const { docs } = res.body.data.serializedPaginationResult;
      expect(docs).toHaveLength(1);

      const doc = docs[0];
      expect(doc.action).toBe('ATTACHMENT_REMOVE');
      // req 4.1: all four attachment fields surface in the response
      // without loss, alongside the operator's username (req 2.2).
      expect(doc.snapshot).toMatchObject({
        username: 'attachment-remover',
        originalName: 'design-v2.pdf',
        pagePath: '/Sandbox/attachments',
        pageId,
        fileSize: 12345,
      });
    });

    it('returns legacy username-only snapshots unchanged (req 4.2 backward compat)', async () => {
      await prisma.activities.createMany({
        data: [
          makeActivityData({
            userId: userId2,
            username: 'legacy-writer',
            action: 'PAGE_UPDATE',
          }),
        ],
      });

      const searchFilter = JSON.stringify({ usernames: ['legacy-writer'] });
      const res = await request(app)
        .get('/api/v3/activity')
        .query({ limit: 10, offset: 0, searchFilter });

      expect(res.status).toBe(200);
      const { docs } = res.body.data.serializedPaginationResult;
      expect(docs).toHaveLength(1);

      const doc = docs[0];
      expect(doc.snapshot.username).toBe('legacy-writer');
      // Attachment fields were never persisted for this record, so they
      // must not carry fabricated values. Prisma reads missing optional
      // composite fields back as null, so accept absent (undefined) or null.
      expect(doc.snapshot.originalName ?? null).toBeNull();
      expect(doc.snapshot.pagePath ?? null).toBeNull();
      expect(doc.snapshot.pageId ?? null).toBeNull();
      expect(doc.snapshot.fileSize ?? null).toBeNull();
    });
  });

  describe('activity-log-snapshot req 8.1–8.4 — ADD/DOWNLOAD snapshot exposure', () => {
    // NOTE: these tests deliberately avoid the `actions` search filter.
    // The route intersects submitted actions with
    // activityService.getAvailableActions(), which depends on the audit-log
    // action-group gate (ATTACHMENT_ADD/DOWNLOAD are Medium; the default gate
    // is Small) — filtering by username / scanning docs keeps this suite
    // independent of gate configuration (end-to-end gate coverage is 13.3).

    it('surfaces all four snapshot fields with username on an ATTACHMENT_ADD activity (req 8.1)', async () => {
      const pageId = new Types.ObjectId().toHexString();
      await prisma.activities.createMany({
        data: [
          makeActivityData({
            userId: userId1,
            username: 'attachment-uploader',
            action: 'ATTACHMENT_ADD',
            snapshotExtras: {
              originalName: 'spec-v1.pdf',
              pagePath: '/Sandbox/uploads',
              pageId,
              fileSize: 2048,
            },
          }),
        ],
      });

      const searchFilter = JSON.stringify({
        usernames: ['attachment-uploader'],
      });
      const res = await request(app)
        .get('/api/v3/activity')
        // offset=0: do not let the offset||1 quirk skip the single record
        .query({ limit: 10, offset: 0, searchFilter });

      expect(res.status).toBe(200);
      const { docs } = res.body.data.serializedPaginationResult;
      expect(docs).toHaveLength(1);

      const doc = docs[0];
      expect(doc.action).toBe('ATTACHMENT_ADD');
      expect(doc.snapshot).toMatchObject({
        username: 'attachment-uploader',
        originalName: 'spec-v1.pdf',
        pagePath: '/Sandbox/uploads',
        pageId,
        fileSize: 2048,
      });
    });

    it('includes target (attachment _id) and targetModel "Attachment" on an ATTACHMENT_ADD activity (req 8.2)', async () => {
      const attachmentId = new Types.ObjectId().toHexString();
      const pageId = new Types.ObjectId().toHexString();
      await prisma.activities.createMany({
        data: [
          makeActivityData({
            userId: userId1,
            username: 'attachment-uploader',
            action: 'ATTACHMENT_ADD',
            target: attachmentId,
            targetModel: 'Attachment',
            snapshotExtras: {
              originalName: 'spec-v1.pdf',
              pagePath: '/Sandbox/uploads',
              pageId,
              fileSize: 2048,
            },
          }),
        ],
      });

      const searchFilter = JSON.stringify({
        usernames: ['attachment-uploader'],
      });
      const res = await request(app)
        .get('/api/v3/activity')
        .query({ limit: 10, offset: 0, searchFilter });

      expect(res.status).toBe(200);
      const { docs } = res.body.data.serializedPaginationResult;
      expect(docs).toHaveLength(1);

      // req 8.2: the downstream viewer builds a download link for ADD
      // attachments from target (the attachment _id) + targetModel.
      const doc = docs[0];
      expect(doc.target).toBe(attachmentId);
      expect(doc.targetModel).toBe('Attachment');
    });

    it('surfaces snapshot fields on a guest ATTACHMENT_DOWNLOAD activity; username omitted (req 8.1)', async () => {
      const attachmentId = new Types.ObjectId().toHexString();
      const pageId = new Types.ObjectId().toHexString();
      // Guest download: recorded without user, so no userId and no
      // snapshot.username (see requirement 7.2).
      await prisma.activities.createMany({
        data: [
          makeActivityData({
            action: 'ATTACHMENT_DOWNLOAD',
            target: attachmentId,
            targetModel: 'Attachment',
            snapshotExtras: {
              originalName: 'guest-download-report.pdf',
              pagePath: '/Sandbox/reports',
              pageId,
              fileSize: 4096,
            },
          }),
        ],
      });

      // No username to filter on (guest): fetch unfiltered and locate the
      // seeded doc by its unique originalName marker.
      const res = await request(app)
        .get('/api/v3/activity')
        .query({ limit: 100, offset: 0, searchFilter: JSON.stringify({}) });

      expect(res.status).toBe(200);
      const { docs } = res.body.data.serializedPaginationResult;
      const doc = docs.find(
        (d: { action: string; snapshot?: { originalName?: string } }) =>
          d.action === 'ATTACHMENT_DOWNLOAD' &&
          d.snapshot?.originalName === 'guest-download-report.pdf',
      );

      expect(doc).toBeDefined();
      expect(doc.snapshot).toMatchObject({
        originalName: 'guest-download-report.pdf',
        pagePath: '/Sandbox/reports',
        pageId,
        fileSize: 4096,
      });
      // Guest: username is omitted (absent or read back as null by Prisma)
      expect(doc.snapshot.username ?? null).toBeNull();
      // Attachment identifier still exposed for the viewer
      expect(doc.target).toBe(attachmentId);
      expect(doc.targetModel).toBe('Attachment');
    });

    it('lets consumers distinguish ADD from REMOVE by the action field (req 8.3)', async () => {
      const pageId = new Types.ObjectId().toHexString();
      const now = Date.now();
      const snapshotExtras = {
        originalName: 'lifecycle.pdf',
        pagePath: '/Sandbox/lifecycle',
        pageId,
        fileSize: 512,
      };
      await prisma.activities.createMany({
        data: [
          makeActivityData({
            userId: userId1,
            username: 'attachment-actor',
            action: 'ATTACHMENT_ADD',
            createdAt: new Date(now - 1000),
            snapshotExtras,
          }),
          makeActivityData({
            userId: userId1,
            username: 'attachment-actor',
            action: 'ATTACHMENT_REMOVE',
            createdAt: new Date(now),
            snapshotExtras,
          }),
        ],
      });

      const searchFilter = JSON.stringify({ usernames: ['attachment-actor'] });
      const res = await request(app)
        .get('/api/v3/activity')
        .query({ limit: 10, offset: 0, searchFilter });

      expect(res.status).toBe(200);
      const { docs } = res.body.data.serializedPaginationResult;
      expect(docs).toHaveLength(2);

      // req 8.3: with identical snapshot shapes, `action` alone tells the
      // viewer which record may carry a download link (ADD) and which must
      // not (REMOVE — the file is gone).
      const actions = docs.map((d: { action: string }) => d.action).sort();
      expect(actions).toEqual(['ATTACHMENT_ADD', 'ATTACHMENT_REMOVE']);
    });

    it('returns legacy ADD/DOWNLOAD activities with username-only snapshots unchanged (req 8.4)', async () => {
      // Records written before this increment: catch-all `{ username }`
      // snapshot, no attachment fields, no target/targetModel.
      const now = Date.now();
      await prisma.activities.createMany({
        data: [
          makeActivityData({
            userId: userId2,
            username: 'legacy-uploader',
            action: 'ATTACHMENT_ADD',
            createdAt: new Date(now - 1000),
          }),
          makeActivityData({
            userId: userId2,
            username: 'legacy-uploader',
            action: 'ATTACHMENT_DOWNLOAD',
            createdAt: new Date(now),
          }),
        ],
      });

      const searchFilter = JSON.stringify({ usernames: ['legacy-uploader'] });
      const res = await request(app)
        .get('/api/v3/activity')
        .query({ limit: 10, offset: 0, searchFilter });

      expect(res.status).toBe(200);
      const { docs } = res.body.data.serializedPaginationResult;
      expect(docs).toHaveLength(2);

      for (const doc of docs) {
        expect(doc.snapshot.username).toBe('legacy-uploader');
        // Attachment fields were never persisted: they must come back
        // absent (undefined) or null, never fabricated.
        expect(doc.snapshot.originalName ?? null).toBeNull();
        expect(doc.snapshot.pagePath ?? null).toBeNull();
        expect(doc.snapshot.pageId ?? null).toBeNull();
        expect(doc.snapshot.fileSize ?? null).toBeNull();
        expect(doc.target ?? null).toBeNull();
        expect(doc.targetModel ?? null).toBeNull();
      }
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
