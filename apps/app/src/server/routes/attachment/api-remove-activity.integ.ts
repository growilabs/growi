/**
 * Integration tests — direct attachment removal settles the activity with an
 * attachment snapshot (task 7.1; read-back-from-real-DB style).
 *
 * Route under test: POST /_api/attachments.remove (api.remove in ./api.js).
 * The request runs through the REAL chain as far as practical:
 *   real addActivity middleware (Option C / lazy fail-safe: mints an id +
 *   stashes request context in pendingActivityContext; no DB write here) →
 *   real api.remove handler → real AttachmentService.removeAttachment
 *   (gridfs uploader; deleteFile no-ops for a file that is not in GridFS) →
 *   real activityEvent 'update' listener registered by the real
 *   ActivityService (crowi.setupActivityService) → real
 *   prisma.activities.createByParameters, which lazily CREATES the row
 *   using the id the middleware pre-minted.
 * Only auth middlewares (accessTokenParser / loginRequired / excludeReadOnly)
 * are replaced by a req.user-injecting stub — the same fidelity trade-off as
 * the apiv3 activity.integ.ts precedent.
 *
 * Every assertion READS THE ACTIVITY BACK FROM THE REAL DATABASE: the update
 * handler in service/activity.ts swallows persistence errors (catch →
 * logger.error → return), so response/return-value assertions cannot catch a
 * silently-failing save (design.md: Testing Strategy "返り値ではなく DB から
 * 読み直して検証する").
 *
 * Recording gate: ACTION_ATTACHMENT_REMOVE is outside the default Small
 * group, so shoudUpdateActivity would reject it. The gate settings are
 * injected through the explicit configManager API (DB-backed updateConfigs,
 * which getConfig prefers over env) — process.env is never mutated.
 *
 * Requires a real MongoDB (wired by vitest.workspace.mts integ setup;
 * per-worker DB isolation via test/setup/mongo + test/setup/prisma).
 *
 * Requirements: 2.1, 2.2
 * Design: Testing Strategy (読み直し方式・記録可否ゲートの設定注入),
 *   System Flows > 直接削除（要件 2）— 既存 activity の更新
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
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import { routesFactory } from './api';

// Sentinel ip so cleanup deletes only this suite's activity rows
// (used sentinels in sibling suites: 10.0.0.70/.72/.73/.74/.88/.99, 127.0.0.1).
const TEST_IP = '10.0.0.75';
const TEST_USERNAME = 'attachment-remove-activity-integ-user';
const PAGE_PATH = '/attachment-remove-activity-integ';
const ENDPOINT = '/_api/attachments.remove';

interface AuthorizedRequest extends Request {
  user?: IUserHasId;
}

/**
 * Narrows the first warn() argument to the structured context object the
 * shared page-path resolver is expected to log (pino convention: context
 * object FIRST — a string-first call would silently discard the context
 * fields).
 */
const isRemovalWarnContext = (
  value: unknown,
): value is { attachmentId: unknown; pageId: unknown } =>
  typeof value === 'object' &&
  value !== null &&
  'attachmentId' in value &&
  'pageId' in value;

describe('POST /_api/attachments.remove — activity settled with attachment snapshot (read back from DB)', () => {
  let crowi: Crowi;
  let app: express.Application;
  // crowi.models.User is Model<any>, so the created doc is untyped; the
  // fields the middleware/handler read (_id, username) are what matter.
  let testUser: IUserHasId;
  // The same user's _id in its runtime (ObjectId) form, for Mongoose refs
  // (IUserHasId types _id as string while the doc actually holds ObjectId).
  let testUserId: Types.ObjectId;

  const createdAttachmentIds: Types.ObjectId[] = [];

  /** Create a removable attachment doc and register it for cleanup. */
  async function arrangeAttachment(overrides: {
    page: Types.ObjectId;
    creator?: Types.ObjectId;
    originalName: string;
    fileSize: number;
  }) {
    const attachment = await Attachment.create({
      page: overrides.page,
      creator: overrides.creator,
      // fileName is globally unique — suffix with a fresh ObjectId
      fileName: `attachment-remove-activity-integ-${new Types.ObjectId().toHexString()}.dat`,
      fileFormat: 'application/octet-stream',
      fileSize: overrides.fileSize,
      originalName: overrides.originalName,
      attachmentType: AttachmentType.WIKI_PAGE,
    });
    createdAttachmentIds.push(attachment._id);
    return attachment;
  }

  /** POST the removal request as the test user from the sentinel ip. */
  function postRemove(attachmentId: string) {
    return request(app)
      .post(ENDPOINT)
      .set('X-Forwarded-For', TEST_IP)
      .send({ attachment_id: attachmentId });
  }

  /**
   * Read the settled activity back from the real DB.
   *
   * Under Option C (lazy fail-safe), addActivity no longer pre-creates the
   * row: it only mints an id and stashes context. The row is created by the
   * ActivityService 'update' listener asynchronously, after the HTTP
   * response is sent. Poll for the row to APPEAR (it may not exist at all
   * yet) and to settle to the real action -- both checks live inside the
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
        expect(row.action).toBe(SupportedAction.ACTION_ATTACHMENT_REMOVE);
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
    // ACTION_ATTACHMENT_REMOVE belongs to MediumActionGroup.
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
      name: 'Attachment Remove Activity Integ User',
      username: TEST_USERNAME,
      email: 'attachment-remove-activity-integ@example.com',
    });
    testUserId = new Types.ObjectId(testUser._id);

    const { api } = routesFactory(crowi);

    app = express();
    // Trust X-Forwarded-For so req.ip (recorded by addActivity) becomes the
    // sentinel value used for row cleanup.
    app.set('trust proxy', true);
    app.use(express.json());
    // Auth middleware stand-in: inject the authenticated user
    // (same trade-off as the apiv3 activity.integ.ts precedent).
    app.use((req: AuthorizedRequest, _res: Response, next: NextFunction) => {
      req.user = testUser;
      next();
    });
    app.post(ENDPOINT, generateAddActivityMiddleware(), api.remove);
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

  it('req 2.1/2.2 — settles the middleware-created activity with the four attachment fields + username, target = attachment._id, targetModel = Attachment', async () => {
    // Arrange: a real public page and a real attachment doc belonging to it
    const [page] = await crowi.models.Page.insertMany([
      {
        path: PAGE_PATH,
        grant: PageGrant.GRANT_PUBLIC,
        creator: testUserId,
      },
    ]);
    const attachment = await arrangeAttachment({
      page: page._id,
      creator: testUserId,
      originalName: 'design-v2.pdf',
      fileSize: 34567,
    });

    // Act
    const res = await postRemove(attachment._id.toString());
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Assert: read the activity back from the real DB
    const settled = await readBackSettledActivity();

    expect(settled.target).toBe(attachment._id.toString());
    expect(settled.targetModel).toBe(MODEL_ATTACHMENT);
    expect(settled.snapshot).toMatchObject({
      username: TEST_USERNAME,
      originalName: 'design-v2.pdf',
      pagePath: PAGE_PATH,
      pageId: page._id.toString(),
      fileSize: 34567,
    });
    // The middleware-written composite id survives the settle
    expect(settled.snapshot.id.length).toBeGreaterThan(0);

    // The listener settles (creates) exactly once per request — no second
    // row is created for this request.
    expect(await prisma.activities.count({ where: { ip: TEST_IP } })).toBe(1);

    // The real deletion path actually ran (not stubbed): the doc is gone.
    expect(await Attachment.findById(attachment._id)).toBeNull();
  });

  it('page unresolvable — records the snapshot without pagePath and warns with attachmentId/pageId as structured fields (pino arg order)', async () => {
    // Arrange: the attachment references a page that does not exist.
    // creator is left unset so isDeletableByUser passes without a page
    // lookup (a creator-owned attachment on a missing page is undeletable).
    const missingPageId = new Types.ObjectId();
    const attachment = await arrangeAttachment({
      page: missingPageId,
      originalName: 'orphan.txt',
      fileSize: 42,
    });

    // Loggers are cached per namespace, so this is the very instance the
    // shared resolveAttachmentPagePath (service/activity/attachment-snapshot,
    // which ./api.js delegates to) logs through.
    const warnSpy = vi.spyOn(
      loggerFactory('growi:service:activity:attachment-snapshot'),
      'warn',
    );

    try {
      // Act
      const res = await postRemove(attachment._id.toString());
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Assert: activity settled with everything except pagePath
      const settled = await readBackSettledActivity();
      expect(settled.target).toBe(attachment._id.toString());
      expect(settled.targetModel).toBe(MODEL_ATTACHMENT);
      expect(settled.snapshot).toMatchObject({
        username: TEST_USERNAME,
        originalName: 'orphan.txt',
        pageId: missingPageId.toString(),
        fileSize: 42,
      });
      // pagePath was not persisted — Prisma reads the absent field as null
      expect(settled.snapshot.pagePath).toBeNull();

      // Assert: the warning carries the ids as structured fields — the
      // context object must be the FIRST argument (pino convention); a
      // swapped call would log a string first and lose the fields.
      const structuredWarnCall = warnSpy.mock.calls.find(
        (args) => isRemovalWarnContext(args[0]) && typeof args[1] === 'string',
      );
      expect(structuredWarnCall).toBeDefined();
      const context = structuredWarnCall?.[0];
      if (!isRemovalWarnContext(context)) {
        throw new Error(
          'expected the structured context object as the first warn argument',
        );
      }
      expect(String(context.attachmentId)).toBe(attachment._id.toString());
      expect(String(context.pageId)).toBe(missingPageId.toString());
    } finally {
      warnSpy.mockRestore();
    }
  });
});
