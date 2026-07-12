/**
 * Integration tests — the audit-log API surfaces activities produced by the
 * REAL attachment-removal flow (task 7.4; end-to-end response verification).
 *
 * Differential value over the hand-seeded tests in ./activity.integ.ts
 * (task 6.1): those seed rows with prisma.activities.createMany, so they
 * cannot detect drift between "the shape the real persistence path writes"
 * and "the shape the test wrote". Here the ATTACHMENT_REMOVE activity is
 * created by the real recording pipeline:
 *   real addActivity middleware (creates the ACTION_UNSETTLED row) →
 *   real POST /_api/attachments.remove handler →
 *   real activityEvent 'update' listener (registered by
 *   crowi.setupActivityService in the test crowi instance) →
 *   real prisma.activities.createByParameters (lazy settle via
 *   settleActivityRecord).
 * Then the REAL GET /api/v3/activity router (supertest) must return that
 * row with all four attachment snapshot fields + username exactly as the
 * persistence path wrote them, along with target / targetModel.
 *
 * Backward compat (req 4.2): a legacy username-only row (hand-seeded — the
 * legacy shape is no longer produced by any real flow, so hand-seeding is
 * the correct arrangement for it) must coexist in the SAME response without
 * breaking it.
 *
 * Recording gate: injected through the explicit configManager API
 * (DB-backed updateConfigs) — process.env is never mutated. Per-worker DB
 * isolation comes from the vitest integ setup (test/setup/mongo + prisma).
 *
 * Requirements: 4.1, 4.2
 * Design: Components and Interfaces > Routes > Audit Log API,
 *   Testing Strategy (読み直し方式・記録可否ゲートの設定注入)
 */

import type { IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import { Types } from 'mongoose';
import request from 'supertest';

import { getInstance } from '^/test/setup/crowi';

import {
  ActionGroupSize,
  MODEL_ATTACHMENT,
  SupportedAction,
} from '~/interfaces/activity';
import { AttachmentMethodType } from '~/interfaces/attachment';
import type Crowi from '~/server/crowi';
import { AttachmentType } from '~/server/interfaces/attachment';
import { generateAddActivityMiddleware } from '~/server/middlewares/add-activity';
import { Attachment } from '~/server/models/attachment';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import { routesFactory } from '../attachment/api';
import type { ApiV3Response } from './interfaces/apiv3-response';

// ---------------------------------------------------------------------------
// Passthrough middleware stubs (bypass auth for the apiv3 activity router —
// same fidelity trade-off as the ./activity.integ.ts precedent)
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

// Sentinel ip so cleanup deletes only this suite's activity rows
// (used sentinels in sibling suites: 10.0.0.55/.56/.57/.70/.71/.72/.73/.74/
//  .75/.76/.77/.88/.99, 127.0.0.1).
const TEST_IP = '10.0.0.78';
const TEST_USERNAME = 'activity-real-removal-response-integ-user';
const PAGE_PATH = '/activity-real-removal-response-integ';
const REMOVE_ENDPOINT = '/_api/attachments.remove';

interface AuthorizedRequest extends Request {
  user?: IUserHasId;
}

/**
 * The slice of a response doc this suite asserts on (the JSON boundary of
 * `serializedPaginationResult.docs[]` is untyped in supertest responses).
 */
interface ResponseActivityDoc {
  action: string;
  target?: string | null;
  targetModel?: string | null;
  snapshot: {
    id: string;
    username?: string | null;
    originalName?: string | null;
    pagePath?: string | null;
    pageId?: string | null;
    fileSize?: number | null;
  };
  user?: { username?: string | null } | null;
}

describe('GET /api/v3/activity — response for activities produced by the real removal flow', () => {
  let crowi: Crowi;
  /** App mounting the real attachment-removal route (creates the activity). */
  let removalApp: express.Application;
  /** App mounting the real apiv3 activity router (the response under test). */
  let activityApp: express.Application;
  let testUser: IUserHasId;
  let testUserId: Types.ObjectId;
  let pageId: Types.ObjectId;

  const createdAttachmentIds: Types.ObjectId[] = [];

  /** Create a removable attachment doc and register it for cleanup. */
  async function arrangeAttachment(overrides: {
    originalName: string;
    fileSize: number;
  }) {
    const attachment = await Attachment.create({
      page: pageId,
      creator: testUserId,
      // fileName is globally unique — suffix with a fresh ObjectId
      fileName: `activity-real-removal-response-integ-${new Types.ObjectId().toHexString()}.dat`,
      fileFormat: 'application/octet-stream',
      fileSize: overrides.fileSize,
      originalName: overrides.originalName,
      attachmentType: AttachmentType.WIKI_PAGE,
    });
    createdAttachmentIds.push(attachment._id);
    return attachment;
  }

  /**
   * Run the REAL removal flow (addActivity middleware → api.remove →
   * activityEvent 'update' listener) and wait until the row appears in the
   * real DB, settled as ACTION_ATTACHMENT_REMOVE.
   *
   * Under lazy fail-safe (Option C — activity-log spec Task 4/5), the
   * add-activity middleware no longer eagerly pre-creates an ACTION_UNSETTLED
   * row; the row is created asynchronously by the 'update' listener AFTER the
   * HTTP response, already as the real ACTION_ATTACHMENT_REMOVE action. So we
   * poll for the row to APPEAR (reading immediately after the response would
   * race the listener). Only this suite's sentinel ip+endpoint matches, and
   * beforeEach wipes it, so exactly one row appears.
   */
  async function removeViaRealFlowAndWaitForSettle(attachmentId: string) {
    const res = await request(removalApp)
      .post(REMOVE_ENDPOINT)
      .set('X-Forwarded-For', TEST_IP)
      .send({ attachment_id: attachmentId });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    return await vi.waitFor(
      async () => {
        const row = await prisma.activities.findFirstOrThrow({
          where: { ip: TEST_IP, endpoint: REMOVE_ENDPOINT },
        });
        expect(row.action).toBe(SupportedAction.ACTION_ATTACHMENT_REMOVE);
        return row;
      },
      { timeout: 5000, interval: 50 },
    );
  }

  /** GET the audit-log list scoped to this suite's rows via username filter. */
  function getActivityList() {
    const searchFilter = JSON.stringify({ usernames: [TEST_USERNAME] });
    // offset=0 explicitly: the default `offset || 1` quirk would skip the
    // newest record (see ./activity.integ.ts req 2.1 tests).
    return request(activityApp)
      .get('/api/v3/activity')
      .query({ limit: 10, offset: 0, searchFilter });
  }

  beforeAll(async () => {
    crowi = await getInstance();

    // --- Recording gate injection (NO process.env mutation) ---
    // shoudUpdateActivity reads these via configManager.getConfig, which
    // prefers the DB-sourced value written by this explicit API over env.
    // ACTION_ATTACHMENT_REMOVE belongs to MediumActionGroup; auditLogEnabled
    // also gates the apiv3 activity route (405 when falsy).
    await configManager.updateConfigs({
      'app:auditLogEnabled': true,
      'app:auditLogActionGroupSize': ActionGroupSize.Medium,
    });

    // Real file-upload service: the gridfs uploader's deleteFile warns and
    // returns when the blob does not exist, so the real removeAttachment
    // path completes for metadata-only attachment docs (no file seeding).
    await configManager.updateConfig(
      'app:fileUploadType',
      AttachmentMethodType.gridfs,
    );
    await crowi.setUpFileUpload(true);

    testUser = await crowi.models.User.create({
      name: 'Activity Real Removal Response Integ User',
      username: TEST_USERNAME,
      email: 'activity-real-removal-response-integ@example.com',
    });
    testUserId = new Types.ObjectId(testUser._id);

    const [page] = await crowi.models.Page.insertMany([
      {
        path: PAGE_PATH,
        grant: PageGrant.GRANT_PUBLIC,
        creator: testUserId,
      },
    ]);
    pageId = page._id;

    // App 1 — the real removal route with the real addActivity middleware.
    // Trust X-Forwarded-For so req.ip (recorded by addActivity) becomes the
    // sentinel value used for row cleanup.
    const { api } = routesFactory(crowi);
    removalApp = express();
    removalApp.set('trust proxy', true);
    removalApp.use(express.json());
    // Auth middleware stand-in: inject the authenticated user
    // (same trade-off as the ../attachment/api-remove-activity.integ.ts
    // precedent).
    removalApp.use(
      (req: AuthorizedRequest, _res: Response, next: NextFunction) => {
        req.user = testUser;
        next();
      },
    );
    removalApp.post(
      REMOVE_ENDPOINT,
      generateAddActivityMiddleware(),
      api.remove,
    );

    // App 2 — the real apiv3 activity router (response under test).
    const { setup } = await import('./activity');
    const activityRouter = setup(crowi);
    activityApp = express();
    activityApp.use(express.json());
    // Inject apiv3 response helpers to match real middleware
    activityApp.use(
      (_req: Request, res: Response & ApiV3Response, next: NextFunction) => {
        // biome-ignore lint/suspicious/noExplicitAny: test helper shim
        res.apiv3 = (data: any) => res.json({ ok: true, data });
        // biome-ignore lint/suspicious/noExplicitAny: test helper shim
        res.apiv3Err = (err: any, code = 400) =>
          res.status(code).json({ ok: false, error: String(err) });
        next();
      },
    );
    activityApp.use('/api/v3/activity', activityRouter);
  }, 120_000);

  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
    await Attachment.deleteMany({ _id: { $in: createdAttachmentIds } });
    await crowi.models.Page.deleteMany({ path: PAGE_PATH });
    await crowi.models.User.deleteMany({ username: TEST_USERNAME });
    // Remove the injected config rows so later suites in this worker's DB
    // see the pristine (env/default) values again.
    await configManager.updateConfigs(
      {
        'app:auditLogEnabled': undefined,
        'app:auditLogActionGroupSize': undefined,
        'app:fileUploadType': undefined,
      },
      { removeIfUndefined: true },
    );
  });

  it('req 4.1 — surfaces the four attachment fields + username exactly as the real persistence path wrote them, with target/targetModel', async () => {
    // Arrange: a real attachment, removed through the real flow
    const attachment = await arrangeAttachment({
      originalName: 'quarterly-report.pdf',
      fileSize: 45678,
    });
    const settled = await removeViaRealFlowAndWaitForSettle(
      attachment._id.toString(),
    );

    // Act: fetch through the real apiv3 activity router
    const res = await getActivityList();

    // Assert
    expect(res.status).toBe(200);
    const docs: ResponseActivityDoc[] =
      res.body.data.serializedPaginationResult.docs;
    expect(docs).toHaveLength(1);

    const doc = docs[0];
    expect(doc.action).toBe(SupportedAction.ACTION_ATTACHMENT_REMOVE);
    // The four attachment fields + username carry the values the REAL
    // deletion flow persisted (not values this test wrote to the DB).
    expect(doc.snapshot).toMatchObject({
      username: TEST_USERNAME,
      originalName: 'quarterly-report.pdf',
      pagePath: PAGE_PATH,
      pageId: pageId.toString(),
      fileSize: 45678,
    });
    // The response reflects the exact stored composite: the snapshot id the
    // middleware wrote (and the settle preserved) surfaces unchanged.
    expect(doc.snapshot.id).toBe(settled.snapshot.id);
    // target / targetModel are included in the response as stored
    expect(doc.target).toBe(attachment._id.toString());
    expect(doc.targetModel).toBe(MODEL_ATTACHMENT);
    // The populated user relation resolves to the real actor
    expect(doc.user).toMatchObject({ username: TEST_USERNAME });
  });

  it('req 4.2 — a legacy username-only row coexists with a real-flow row in the same response without breaking it', async () => {
    // Arrange: real-flow row first…
    const attachment = await arrangeAttachment({
      originalName: 'obsolete-diagram.png',
      fileSize: 321,
    });
    await removeViaRealFlowAndWaitForSettle(attachment._id.toString());

    // …then a hand-seeded legacy row (username-only snapshot). Hand-seeding
    // is correct here: the legacy shape is no longer produced by any real
    // flow. Seeded AFTER the settle so the settle-poll cannot pick it up.
    await prisma.activities.create({
      data: {
        id: new Types.ObjectId().toHexString(),
        v: 0,
        action: 'PAGE_UPDATE',
        createdAt: new Date(),
        endpoint: '/test',
        ip: TEST_IP,
        snapshot: {
          id: new Types.ObjectId().toHexString(),
          username: TEST_USERNAME,
        },
        userId: new Types.ObjectId().toHexString(),
      },
    });

    // Act: one request returns both shapes
    const res = await getActivityList();

    // Assert: the mixed response is intact — both rows are returned
    expect(res.status).toBe(200);
    const docs: ResponseActivityDoc[] =
      res.body.data.serializedPaginationResult.docs;
    expect(docs).toHaveLength(2);

    const legacyDoc = docs.find((d) => d.action === 'PAGE_UPDATE');
    const removalDoc = docs.find(
      (d) => d.action === SupportedAction.ACTION_ATTACHMENT_REMOVE,
    );

    // Legacy row: username intact, attachment fields absent — no fabricated
    // values. Prisma reads missing optional composite fields back as null,
    // so accept absent (undefined) or null.
    if (legacyDoc == null) {
      throw new Error('expected the legacy PAGE_UPDATE doc in the response');
    }
    expect(legacyDoc.snapshot.username).toBe(TEST_USERNAME);
    expect(legacyDoc.snapshot.originalName ?? null).toBeNull();
    expect(legacyDoc.snapshot.pagePath ?? null).toBeNull();
    expect(legacyDoc.snapshot.pageId ?? null).toBeNull();
    expect(legacyDoc.snapshot.fileSize ?? null).toBeNull();

    // Real-flow row in the same response still carries all four fields
    if (removalDoc == null) {
      throw new Error(
        'expected the ATTACHMENT_REMOVE doc from the real flow in the response',
      );
    }
    expect(removalDoc.snapshot).toMatchObject({
      username: TEST_USERNAME,
      originalName: 'obsolete-diagram.png',
      pagePath: PAGE_PATH,
      pageId: pageId.toString(),
      fileSize: 321,
    });
  });
});
