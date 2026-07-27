/**
 * Integration tests — attachment ADD settles the activity with an attachment
 * snapshot (task 13.1; read-back-from-real-DB style).
 *
 * Route under test: POST /attachment (apiv3 attachment.js, multipart upload).
 * The request runs through the REAL chain as far as practical:
 *   real multer (uploads.single('file')) → real express-validator +
 *   apiV3FormValidator → real excludeReadOnlyUser → real addActivity
 *   middleware (Option C / lazy fail-safe: mints an id + stashes request
 *   context in pendingActivityContext; no DB write here) → real route
 *   handler (Page.findOne / isAccessiblePageByViewer / real
 *   AttachmentService.createAttachment uploading to GridFS) → real
 *   activityEvent 'update' listener registered by the real ActivityService
 *   (crowi.setupActivityService) → real prisma.activities.createByParameters,
 *   which lazily CREATES the row using the id the middleware pre-minted.
 * Only auth middlewares (accessTokenParser / loginRequired) are replaced by
 * passthroughs plus a req.user-injecting app-level middleware — the same
 * fidelity trade-off as the apiv3 activity.integ.ts precedent.
 *
 * Every assertion READS THE ACTIVITY BACK FROM THE REAL DATABASE: the update
 * handler in service/activity.ts swallows persistence errors (catch →
 * logger.error → return), so response/return-value assertions cannot catch a
 * silently-failing save (design.md: Testing Strategy（増分）「Integration
 * （実 DB 読み直し）」).
 *
 * Recording gate: ACTION_ATTACHMENT_ADD is outside the default Small group,
 * so shoudUpdateActivity would reject it. The gate settings are injected
 * through the explicit configManager API (DB-backed updateConfigs, which
 * getConfig prefers over env) — process.env is never mutated.
 *
 * Requires a real MongoDB (wired by vitest.workspace.mts integ setup;
 * per-worker DB isolation via test/setup/mongo + test/setup/prisma).
 *
 * Requirements: 6.1, 6.2, 6.3
 * Design: Testing Strategy（増分）> Integration > ADD（要件6）,
 *   ADD Capture Integration > Event Contract（emit('update')）,
 *   System Flows（増分）> ADD（要件6）— emit('update') 更新経路
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
import { Attachment } from '~/server/models/attachment';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

import type { ApiV3Response } from './interfaces/apiv3-response';

// ---------------------------------------------------------------------------
// Auth middleware stubs (bypass authentication only)
// ---------------------------------------------------------------------------
// The rest of the chain — multer, validators, excludeReadOnlyUser, the REAL
// addActivity middleware and the real handler — runs unmodified, so the test
// exercises the genuine "middleware mints UNSETTLED id → route emits update"
// path (same trade-off as the apiv3 activity.integ.ts precedent).
const passthrough = (_req: Request, _res: Response, next: NextFunction) =>
  next();

vi.mock('~/server/middlewares/access-token-parser', () => ({
  accessTokenParser: () => passthrough,
}));
vi.mock('~/server/middlewares/login-required', () => ({
  default: () => passthrough,
}));

// Sentinel ip so cleanup deletes only this suite's activity rows
// (used sentinels in sibling suites: 10.0.0.1/.55/.56/.57/.70–.78/.87/.88/
// .91/.92/.99, 127.0.0.1).
const TEST_IP = '10.0.0.79';
const TEST_USERNAME = 'attachment-add-activity-integ-user';
const PAGE_PATH = '/attachment-add-activity-integ';
const MOUNT_PATH = '/attachment';

interface AuthorizedRequest extends Request {
  user?: IUserHasId;
}

describe('POST /attachment — activity settled with attachment snapshot (read back from DB)', () => {
  let crowi: Crowi;
  let app: express.Application;
  // crowi.models.User is Model<any>, so the created doc is untyped; the
  // fields the middleware/handler read (_id, username) are what matter.
  let testUser: IUserHasId;
  // The same user's _id in its runtime (ObjectId) form, for Mongoose refs
  // (IUserHasId types _id as string while the doc actually holds ObjectId).
  let testUserId: Types.ObjectId;

  /** POST a multipart upload as the test user from the sentinel ip. */
  function postAdd(pageId: string, fileBody: Buffer, originalName: string) {
    return request(app)
      .post(MOUNT_PATH)
      .set('X-Forwarded-For', TEST_IP)
      .field('page_id', pageId)
      .attach('file', fileBody, originalName);
  }

  /**
   * Read the settled activity back from the real DB.
   *
   * Under Option C (lazy fail-safe), addActivity no longer pre-creates the
   * row: it only mints an id and stashes context. The row is created by the
   * ActivityService 'update' listener asynchronously, after the HTTP
   * response is sent. Poll for the row to APPEAR (it may not exist at all
   * yet) and to settle to the real action — both checks live inside the
   * same `vi.waitFor` retry loop so an early poll that finds nothing, or
   * finds the row still mid-settle, is retried rather than failing outright.
   */
  async function readBackSettledActivity() {
    // Exactly one row exists per test: beforeEach wipes the sentinel ip and
    // each test issues a single request through the addActivity middleware.
    return await vi.waitFor(
      async () => {
        const row = await prisma.activities.findFirst({
          where: { ip: TEST_IP },
        });
        if (row == null) {
          throw new Error('activity row not yet created for this test');
        }
        expect(row.action).toBe(SupportedAction.ACTION_ATTACHMENT_ADD);
        return row;
      },
      { timeout: 5000, interval: 50 },
    );
  }

  beforeAll(async () => {
    crowi = await getInstance();

    // --- Recording gate injection (NO process.env mutation) ---
    // shoudUpdateActivity reads these via configManager.getConfig, which
    // prefers the DB-sourced value written by this explicit API over env.
    // ACTION_ATTACHMENT_ADD belongs to MediumActionGroup.
    await configManager.updateConfigs({
      'app:auditLogEnabled': true,
      'app:auditLogActionGroupSize': ActionGroupSize.Medium,
    });

    // Real file-upload service: createAttachment streams the multer tmp file
    // into GridFS on the same per-worker test MongoDB, so the genuine upload
    // path runs without any external storage.
    await configManager.updateConfig(
      'app:fileUploadType',
      AttachmentMethodType.gridfs,
    );
    await crowi.setUpFileUpload(true);

    testUser = await crowi.models.User.create({
      name: 'Attachment Add Activity Integ User',
      username: TEST_USERNAME,
      email: 'attachment-add-activity-integ@example.com',
    });
    testUserId = new Types.ObjectId(testUser._id);

    const { setup } = await import('./attachment');
    const router = setup(crowi);

    app = express();
    // Trust X-Forwarded-For so req.ip (recorded by addActivity) becomes the
    // sentinel value used for row cleanup.
    app.set('trust proxy', true);
    // Auth middleware stand-in: inject the authenticated user (loginRequired
    // is stubbed to a passthrough above), and shim the apiv3 response
    // helpers the handler calls (res.apiv3 / res.apiv3Err).
    app.use(
      (
        req: AuthorizedRequest,
        res: Response & ApiV3Response,
        next: NextFunction,
      ) => {
        req.user = testUser;
        // biome-ignore lint/suspicious/noExplicitAny: test helper shim
        res.apiv3 = (data: any) => res.json({ ok: true, data });
        // biome-ignore lint/suspicious/noExplicitAny: test helper shim
        res.apiv3Err = (err: any, code = 400) =>
          res.status(code).json({ ok: false, error: String(err) });
        next();
      },
    );
    app.use(MOUNT_PATH, router);
  }, 120_000);

  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
    // Remove attachments uploaded by this suite through the real service so
    // the GridFS blobs are deleted along with the metadata docs.
    const uploaded = await Attachment.find({ creator: testUserId });
    await Promise.all(
      uploaded.map((attachment) =>
        crowi.attachmentService.removeAttachment(attachment._id),
      ),
    );
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

  it('req 6.1/6.2/6.3 — settles the middleware-created activity with the four attachment fields + username, target = attachment._id, targetModel = Attachment', async () => {
    // Arrange: a real public page. The handler loads this very page
    // (Page.findOne) and passes page.path into the snapshot with no extra
    // lookup, so pagePath MUST come back filled (req 6.1 "page 既ロード").
    // A revision ref is required: the handler serializes page.revision into
    // the response and the serializer dereferences it.
    const [page] = await crowi.models.Page.insertMany([
      {
        path: PAGE_PATH,
        grant: PageGrant.GRANT_PUBLIC,
        creator: testUserId,
        revision: new Types.ObjectId(),
      },
    ]);
    const fileBody = Buffer.from(
      'attachment-add-activity integ payload (task 13.1)',
    );

    // Act: drive the REAL route with a genuine multipart upload
    const res = await postAdd(
      page._id.toString(),
      fileBody,
      'meeting-notes.md',
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // The upload really happened: the attachment doc exists in the real DB
    // (its _id is what the emit must have recorded as target).
    const uploadedAttachmentId: string = res.body.data.attachment._id;
    expect(await Attachment.findById(uploadedAttachmentId)).not.toBeNull();

    // Assert: read the activity back from the real DB
    const settled = await readBackSettledActivity();

    // req 6.3 — the attachment identifier is persisted on the activity so
    // the downstream viewer can build a download link.
    expect(settled.target).toBe(uploadedAttachmentId);
    expect(settled.targetModel).toBe(MODEL_ATTACHMENT);

    // req 6.1 (four attachment fields; pagePath from the already-loaded
    // page; pageId is the stringified attachment.page ObjectId — the
    // page→pageId remapping the type system cannot catch) +
    // req 6.2 (operator username).
    expect(settled.snapshot).toMatchObject({
      username: TEST_USERNAME,
      originalName: 'meeting-notes.md',
      pagePath: PAGE_PATH,
      pageId: page._id.toString(),
      fileSize: fileBody.byteLength,
    });
    // The middleware-minted composite id survives the settle
    expect(settled.snapshot.id.length).toBeGreaterThan(0);

    // The listener settles (creates) exactly once per request — no second
    // row is created for this request (emit-update path, no unique-index
    // collision).
    expect(await prisma.activities.count({ where: { ip: TEST_IP } })).toBe(1);
  });
});
