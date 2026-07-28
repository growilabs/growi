/**
 * Integration tests — attachment DOWNLOAD records an activity with an
 * attachment snapshot (task 13.2; read-back-from-real-DB style).
 *
 * Route under test: GET /download/:id (attachment/download.ts).
 * The request runs through the REAL chain as far as practical:
 *   real certifySharedPageAttachmentMiddleware (no Referer header in these
 *   tests, so it is a no-op passthrough) → real retrieveAttachmentFromIdParam
 *   (Attachment.findById + isAccessiblePageByViewer for the authenticated
 *   case) → real route handler: real getActionFactory dispatches the file
 *   response from the real GridFS-backed fileUploadService, THEN the
 *   module-level recordDownloadActivity runs fire-and-forget (not awaited by
 *   the handler) — real buildAttachmentDownloadSnapshot (which resolves
 *   pagePath via a real Page.findById) and real
 *   crowi.activityService.createActivity (which calls
 *   prisma.activities.createByParameters directly; DOWNLOAD is a create, not
 *   the emit('update') lazy-settle path REMOVE/ADD use).
 * Only login-required is replaced by a passthrough plus an app-level
 * middleware that injects (or omits) req.user per test — the same fidelity
 * trade-off as the apiv3 activity.integ.ts precedent. download.ts does not
 * reference accessTokenParser, so that module is left unmocked.
 *
 * Every assertion READS THE ACTIVITY BACK FROM THE REAL DATABASE:
 * createActivity swallows persistence errors internally (catch →
 * logger.error → return null), and recordDownloadActivity itself is
 * fire-and-forget from the route, so response/return-value assertions alone
 * cannot catch a silently-failing save (design.md: Testing Strategy（増分）
 * > Integration > DOWNLOAD（要件7）).
 *
 * Recording gate: ACTION_ATTACHMENT_DOWNLOAD is outside the default Small
 * group, so shoudUpdateActivity would reject it. The gate settings are
 * injected through the explicit configManager API (DB-backed updateConfigs,
 * which getConfig prefers over env) — process.env is never mutated.
 *
 * Requires a real MongoDB (wired by vitest.workspace.mts integ setup;
 * per-worker DB isolation via test/setup/mongo + test/setup/prisma).
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4
 * Design: Testing Strategy（増分）> Integration > DOWNLOAD（要件7）,
 *   DOWNLOAD Capture Integration > Event Contract（createActivity）,
 *   System Flows（増分）> DOWNLOAD（要件7）— createActivity 新規作成・
 *   fire-and-forget
 */

import { Readable } from 'node:stream';
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
import { Attachment } from '~/server/models/attachment';
import { configManager } from '~/server/service/config-manager';
import loggerFactory from '~/utils/logger';
import { prisma } from '~/utils/prisma';

import { downloadRouterFactory } from './download';

// ---------------------------------------------------------------------------
// Auth middleware stub (bypass authentication only)
// ---------------------------------------------------------------------------
// download.ts only pulls loginRequired from
// '~/server/middlewares/login-required' (it never imports
// access-token-parser), so only that module needs a passthrough stub. The
// rest of the chain — certifySharedPageAttachmentMiddleware,
// retrieveAttachmentFromIdParam, the real handler, GridFS delivery, and the
// real fire-and-forget recording — runs unmodified.
const passthrough = (_req: Request, _res: Response, next: NextFunction) =>
  next();

vi.mock('~/server/middlewares/login-required', () => ({
  default: () => passthrough,
}));

// Sentinel ip so cleanup deletes only this suite's activity rows
// (used sentinels in sibling suites: 10.0.0.1/.55/.56/.57/.70–.79/.87/.88/
// .91/.92/.99, 127.0.0.1).
const TEST_IP = '10.0.0.80';
const TEST_USERNAME = 'attachment-download-activity-integ-user';
const PAGE_PATH = '/attachment-download-activity-integ';
const MOUNT_PATH = '/download';

interface AuthorizedRequest extends Request {
  user?: IUserHasId;
}

/**
 * Narrows the first warn() argument to the structured context object
 * download.ts's recordDownloadActivity is expected to log (pino convention:
 * context object FIRST — a string-first call would silently discard the
 * context fields).
 */
const isDownloadWarnContext = (
  value: unknown,
): value is { attachmentId: unknown } =>
  typeof value === 'object' && value !== null && 'attachmentId' in value;

describe('GET /download/:id — activity recorded with attachment snapshot (read back from DB)', () => {
  let crowi: Crowi;
  let app: express.Application;
  // crowi.models.User is Model<any>, so the created doc is untyped; the
  // fields the route/builder read (_id, username) are what matter.
  let testUser: IUserHasId;
  // The same user's _id in its runtime (ObjectId) form, for Mongoose refs
  // (IUserHasId types _id as string while the doc actually holds ObjectId).
  let testUserId: Types.ObjectId;
  let pageId: Types.ObjectId;

  // Toggled per test by the app-level auth stub below: set to the test user
  // for the authenticated case, left undefined for the guest case.
  let injectedUser: IUserHasId | undefined;

  const createdAttachmentIds: Types.ObjectId[] = [];

  /**
   * Creates a real Attachment doc under the shared test page AND uploads
   * real content to GridFS — the download route's ResponseMode is RELAY
   * (GridfsFileUploader does not override the base class's determination),
   * so findDeliveryFile must find a real GridFS blob for the download to
   * succeed with an actual file body (not just a metadata doc, as the
   * REMOVE precedent uses since deleteFile no-ops for a missing blob).
   */
  async function arrangeDownloadableAttachment(overrides: {
    originalName: string;
    content: string;
  }) {
    const fileSize = Buffer.byteLength(overrides.content);
    const attachment = await Attachment.create({
      page: pageId,
      creator: testUserId,
      // fileName is globally unique — suffix with a fresh ObjectId
      fileName: `attachment-download-activity-integ-${new Types.ObjectId().toHexString()}.dat`,
      fileFormat: 'text/plain',
      fileSize,
      originalName: overrides.originalName,
      attachmentType: AttachmentType.WIKI_PAGE,
    });
    createdAttachmentIds.push(attachment._id);
    await crowi.fileUploadService.uploadAttachment(
      Readable.from(Buffer.from(overrides.content)),
      attachment,
    );
    return attachment;
  }

  /** GET the download as whichever actor is currently injected, from the sentinel ip. */
  function getDownload(attachmentId: string) {
    return request(app)
      .get(`${MOUNT_PATH}/${attachmentId}`)
      .set('X-Forwarded-For', TEST_IP);
  }

  /**
   * Read the recorded activity back from the real DB.
   *
   * DOWNLOAD uses createActivity (a direct create), not the emit('update')
   * lazy-settle path REMOVE/ADD use — but the route still calls
   * recordDownloadActivity fire-and-forget (never awaited), so the row can
   * still be absent at the moment the HTTP response resolves. Poll rather
   * than reading once.
   */
  async function readBackDownloadActivity(target: string) {
    return await vi.waitFor(
      async () => {
        const row = await prisma.activities.findFirst({
          where: { ip: TEST_IP, target },
        });
        if (row == null) {
          throw new Error('activity row not yet created for this test');
        }
        expect(row.action).toBe(SupportedAction.ACTION_ATTACHMENT_DOWNLOAD);
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
    // ACTION_ATTACHMENT_DOWNLOAD belongs to MediumActionGroup.
    await configManager.updateConfigs({
      'app:auditLogEnabled': true,
      'app:auditLogActionGroupSize': ActionGroupSize.Medium,
    });

    // Real file-upload service: uploadAttachment streams straight into
    // GridFS on the same per-worker test MongoDB, so the genuine delivery
    // path (findDeliveryFile + pipe) runs without any external storage.
    await configManager.updateConfig(
      'app:fileUploadType',
      AttachmentMethodType.gridfs,
    );
    await crowi.setUpFileUpload(true);

    testUser = await crowi.models.User.create({
      name: 'Attachment Download Activity Integ User',
      username: TEST_USERNAME,
      email: 'attachment-download-activity-integ@example.com',
    });
    testUserId = new Types.ObjectId(testUser._id);

    // A real public page shared by all cases: DOWNLOAD's pagePath is
    // resolved via Page.findById (unlike ADD, which reuses an already-loaded
    // page doc), so this exercises the actual lookup (requirement 7.3).
    const [page] = await crowi.models.Page.insertMany([
      {
        path: PAGE_PATH,
        grant: PageGrant.GRANT_PUBLIC,
        creator: testUserId,
      },
    ]);
    pageId = page._id;

    app = express();
    // Trust X-Forwarded-For so req.ip (recorded as the activity's ip)
    // becomes the sentinel value used for row cleanup.
    app.set('trust proxy', true);
    // Auth stand-in: inject whichever actor the current test selected
    // (loginRequired is stubbed to a passthrough above). Left undefined for
    // the guest case.
    app.use((req: AuthorizedRequest, _res: Response, next: NextFunction) => {
      req.user = injectedUser;
      next();
    });
    app.use(MOUNT_PATH, downloadRouterFactory(crowi));
  }, 120_000);

  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
    injectedUser = undefined;
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
    // Remove attachments (metadata + GridFS blob) uploaded by this suite.
    await Promise.all(
      createdAttachmentIds.map((id) =>
        crowi.attachmentService.removeAttachment(id),
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

  it('req 7.1/7.2/7.3 — authenticated download records the attachment snapshot with username and pagePath, target = attachment._id, targetModel = Attachment', async () => {
    const content =
      'attachment-download-activity integ payload — authed (task 13.2)';
    const attachment = await arrangeDownloadableAttachment({
      originalName: 'authed-notes.txt',
      content,
    });

    injectedUser = testUser;

    // Act: drive the REAL route; the file body must come back intact.
    const res = await getDownload(attachment._id.toString());
    expect(res.status).toBe(200);
    expect(res.text).toBe(content);

    // Assert: read the activity back from the real DB
    const recorded = await readBackDownloadActivity(attachment._id.toString());

    // req 7.1 — the attachment identifier is persisted so the downstream
    // viewer can build a download link.
    expect(recorded.target).toBe(attachment._id.toString());
    expect(recorded.targetModel).toBe(MODEL_ATTACHMENT);

    // req 7.1 (originalName/pageId/fileSize + pagePath resolved via
    // Page.findById) + req 7.2 (authenticated operator's username recorded).
    expect(recorded.snapshot).toMatchObject({
      username: TEST_USERNAME,
      originalName: 'authed-notes.txt',
      pagePath: PAGE_PATH,
      pageId: pageId.toString(),
      fileSize: Buffer.byteLength(content),
    });

    // Exactly one row is created for this request (createActivity path, no
    // pre-minted id / settle step).
    expect(
      await prisma.activities.count({
        where: { ip: TEST_IP, target: attachment._id.toString() },
      }),
    ).toBe(1);
  });

  it('req 7.2 — guest (unauthenticated) download records the snapshot without a username', async () => {
    const content =
      'attachment-download-activity integ payload — guest (task 13.2)';
    const attachment = await arrangeDownloadableAttachment({
      originalName: 'guest-notes.txt',
      content,
    });

    // injectedUser stays undefined (reset in beforeEach) — guest download.

    const res = await getDownload(attachment._id.toString());
    expect(res.status).toBe(200);
    expect(res.text).toBe(content);

    const recorded = await readBackDownloadActivity(attachment._id.toString());
    expect(recorded.target).toBe(attachment._id.toString());
    expect(recorded.targetModel).toBe(MODEL_ATTACHMENT);
    expect(recorded.snapshot).toMatchObject({
      originalName: 'guest-notes.txt',
      pagePath: PAGE_PATH,
      pageId: pageId.toString(),
      fileSize: Buffer.byteLength(content),
    });
    // req 7.2 — no operator to attribute the download to; username is
    // omitted (Prisma reads the unset optional composite field back as null).
    expect(recorded.snapshot.username).toBeNull();
  });

  it('req 7.4 — a recording failure does not affect the download response (best-effort)', async () => {
    const content =
      'attachment-download-activity integ payload — failure injection (task 13.2)';
    const attachment = await arrangeDownloadableAttachment({
      originalName: 'best-effort-notes.txt',
      content,
    });

    const { activityService } = crowi;
    if (activityService == null) {
      throw new Error('activityService must be initialized by getInstance()');
    }
    // Inject the failure at the save port — the cleanest point that still
    // exercises recordDownloadActivity's own try/catch (snapshot building
    // runs for real; only persistence fails).
    const createActivitySpy = vi
      .spyOn(activityService, 'createActivity')
      .mockRejectedValueOnce(new Error('simulated recording failure'));
    // Loggers are cached per namespace, so this is the very instance
    // recordDownloadActivity (download.ts) logs through.
    const warnSpy = vi.spyOn(
      loggerFactory('growi:routes:attachment:download'),
      'warn',
    );

    try {
      injectedUser = testUser;

      // Act: the download response must stay intact (status AND body)
      // despite the injected recording failure.
      const res = await getDownload(attachment._id.toString());
      expect(res.status).toBe(200);
      expect(res.text).toBe(content);

      // Assert: the best-effort catch in recordDownloadActivity actually ran
      // (no unhandled rejection escaped it). Recording is fire-and-forget,
      // so it settles some time after the response above — poll for it.
      await vi.waitFor(
        () => {
          expect(warnSpy).toHaveBeenCalled();
        },
        { timeout: 5000, interval: 50 },
      );

      const structuredWarnCall = warnSpy.mock.calls.find(
        (args) => isDownloadWarnContext(args[0]) && typeof args[1] === 'string',
      );
      expect(structuredWarnCall).toBeDefined();
      const context = structuredWarnCall?.[0];
      if (!isDownloadWarnContext(context)) {
        throw new Error(
          'expected the structured context object as the first warn argument',
        );
      }
      expect(String(context.attachmentId)).toBe(attachment._id.toString());
      expect(structuredWarnCall?.[1]).toBe(
        'Failed to record the attachment download activity',
      );

      // No row was persisted for this failed attempt.
      expect(
        await prisma.activities.count({
          where: { ip: TEST_IP, target: attachment._id.toString() },
        }),
      ).toBe(0);
    } finally {
      createActivitySpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
