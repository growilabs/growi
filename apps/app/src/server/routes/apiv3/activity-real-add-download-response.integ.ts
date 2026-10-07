/**
 * Integration tests — the audit-log API surfaces activities produced by the
 * REAL attachment ADD and DOWNLOAD flows, together with a REAL REMOVE (for
 * req 8.3's action-based distinguishability) and a hand-seeded legacy row
 * (req 8.4).
 *
 * Differential value over the hand-seeded tests in ./activity.integ.ts
 * (task 12.1): those seed rows with prisma.activities.createMany, so they
 * cannot detect drift between "the shape the real persistence path writes"
 * and "the shape the test wrote". Here every non-legacy row is created by
 * the real recording pipeline for its action:
 *   - ADD:      real addActivity middleware (Option C lazy fail-safe: mints
 *               an id, no eager row) → real POST /attachment handler
 *               (apiv3/attachment.js, genuine multipart upload via multer +
 *               GridFS) → real activityEvent 'update' listener → real
 *               prisma.activities.createByParameters (lazy settle).
 *   - DOWNLOAD: real GET /download/:id handler (attachment/download.ts) →
 *               real fire-and-forget recordDownloadActivity → real
 *               buildAttachmentDownloadSnapshot (resolves pagePath via a
 *               real Page.findById) → real
 *               crowi.activityService.createActivity.
 *   - REMOVE:   real addActivity middleware → real POST
 *               /_api/attachments.remove handler (attachment/api.js) → real
 *               activityEvent 'update' listener → real
 *               prisma.activities.createByParameters (lazy settle).
 *               Included because req 8.3's actual purpose is
 *               "can the downstream viewer tell an entity-preserved
 *               attachment (ADD/DOWNLOAD) from an entity-gone one (REMOVE)
 *               apart by `action`" — arranging it costs only one more
 *               attachment doc + the same real-flow idiom task 7.4 already
 *               established, so it is included with real data rather than
 *               relying solely on the hand-seeded coverage in 12.1.
 * Then the REAL GET /api/v3/activity router (supertest) must return all
 * three rows with the correct snapshot / target / targetModel fields, and
 * distinguishable from one another by `action` alone.
 *
 * Backward compat (req 8.4): a legacy username-only ATTACHMENT_DOWNLOAD row
 * (hand-seeded — this shape is no longer produced by any real flow once this
 * increment ships, so hand-seeding is the correct arrangement for it) must
 * coexist in the SAME response as a real ADD row without breaking it.
 *
 * Recording gate: injected through the explicit configManager API
 * (DB-backed updateConfigs) — process.env is never mutated. Per-worker DB
 * isolation comes from the vitest integ setup (test/setup/mongo + prisma).
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4
 * Design: Testing Strategy（増分）> Integration > API（要件8）,
 *   Components and Interfaces（増分）> Routes > Audit Log API > API Contract
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
import { downloadRouterFactory } from '../attachment/download';
import type { ApiV3Response } from './interfaces/apiv3-response';

// ---------------------------------------------------------------------------
// Passthrough middleware stubs (bypass auth — same fidelity trade-off as the
// activity-real-removal-response.integ.ts / attachment-add-activity.integ.ts /
// download-activity.integ.ts precedents this file draws on)
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
// (used sentinels in sibling suites: 10.0.0.1/.55/.56/.57/.70-.80/.87/.88/
//  .91/.92/.99, 127.0.0.1).
const TEST_IP = '10.0.0.81';
const TEST_USERNAME = 'activity-real-add-download-response-integ-user';
const PAGE_PATH = '/activity-real-add-download-response-integ';
const ADD_MOUNT = '/attachment';
const DOWNLOAD_MOUNT = '/download';
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
}

describe('GET /api/v3/activity — response for activities produced by the real ADD/DOWNLOAD flows', () => {
  let crowi: Crowi;
  /** App mounting the real apiv3 attachment ADD route. */
  let addApp: express.Application;
  /** App mounting the real attachment DOWNLOAD route. */
  let downloadApp: express.Application;
  /** App mounting the real attachment REMOVE handler (attachment/api.js). */
  let removeApp: express.Application;
  /** App mounting the real apiv3 activity router (the response under test). */
  let activityApp: express.Application;
  let testUser: IUserHasId;
  let testUserId: Types.ObjectId;
  let pageId: Types.ObjectId;

  /** POST a multipart upload as the test user from the sentinel ip. */
  function postAdd(pageIdStr: string, fileBody: Buffer, originalName: string) {
    return request(addApp)
      .post(ADD_MOUNT)
      .set('X-Forwarded-For', TEST_IP)
      .field('page_id', pageIdStr)
      .attach('file', fileBody, originalName);
  }

  /** GET a download as the test user from the sentinel ip. */
  function getDownload(attachmentId: string) {
    return request(downloadApp)
      .get(`${DOWNLOAD_MOUNT}/${attachmentId}`)
      .set('X-Forwarded-For', TEST_IP);
  }

  /** Create a removable attachment doc (metadata only, no GridFS blob needed —
   * removeAttachment's gridfs deleteFile warns and returns for a missing blob,
   * same as the activity-real-removal-response.integ.ts precedent). */
  async function arrangeRemovableAttachment(overrides: {
    originalName: string;
    fileSize: number;
  }) {
    return await Attachment.create({
      page: pageId,
      creator: testUserId,
      // fileName is globally unique — suffix with a fresh ObjectId
      fileName: `activity-real-add-download-response-integ-${new Types.ObjectId().toHexString()}.dat`,
      fileFormat: 'application/octet-stream',
      fileSize: overrides.fileSize,
      originalName: overrides.originalName,
      attachmentType: AttachmentType.WIKI_PAGE,
    });
  }

  /** Run the REAL removal flow (addActivity middleware → api.remove → activityEvent 'update' listener). */
  function removeAttachmentViaRealFlow(attachmentId: string) {
    return request(removeApp)
      .post(REMOVE_ENDPOINT)
      .set('X-Forwarded-For', TEST_IP)
      .send({ attachment_id: attachmentId });
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

  /**
   * Poll until an activity row for the given target + action appears.
   *
   * All three recording paths exercised in this suite are asynchronous with
   * respect to their HTTP response (ADD/REMOVE settle via a lazy
   * activityEvent 'update' listener; DOWNLOAD records fire-and-forget), so
   * reading immediately after the response would race the writer.
   */
  async function waitForActivityByTarget(
    target: string,
    expectedAction: string,
  ) {
    return await vi.waitFor(
      async () => {
        const row = await prisma.activities.findFirst({
          where: { ip: TEST_IP, target, action: expectedAction },
        });
        if (row == null) {
          throw new Error(
            `activity row not yet created for target=${target} action=${expectedAction}`,
          );
        }
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
    // ACTION_ATTACHMENT_ADD/DOWNLOAD/REMOVE all belong to MediumActionGroup;
    // auditLogEnabled also gates the apiv3 activity route (405 when falsy).
    await configManager.updateConfigs({
      'app:auditLogEnabled': true,
      'app:auditLogActionGroupSize': ActionGroupSize.Medium,
    });

    // Real file-upload service: ADD streams into GridFS, DOWNLOAD reads it
    // back, and REMOVE's gridfs deleteFile warns-and-returns for a missing
    // blob (metadata-only attachment docs created directly for REMOVE).
    await configManager.updateConfig(
      'app:fileUploadType',
      AttachmentMethodType.gridfs,
    );
    await crowi.setUpFileUpload(true);

    testUser = await crowi.models.User.create({
      name: 'Activity Real Add Download Response Integ User',
      username: TEST_USERNAME,
      email: 'activity-real-add-download-response-integ@example.com',
    });
    testUserId = new Types.ObjectId(testUser._id);

    // A revision ref is required: the ADD route handler serializes
    // page.revision into the response and the serializer dereferences it.
    const [page] = await crowi.models.Page.insertMany([
      {
        path: PAGE_PATH,
        grant: PageGrant.GRANT_PUBLIC,
        creator: testUserId,
        revision: new Types.ObjectId(),
      },
    ]);
    pageId = page._id;

    // App 1 — the real apiv3 attachment ADD route.
    const { setup: setupAttachment } = await import('./attachment');
    const attachmentRouter = setupAttachment(crowi);
    addApp = express();
    addApp.set('trust proxy', true);
    addApp.use(
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
    addApp.use(ADD_MOUNT, attachmentRouter);

    // App 2 — the real attachment DOWNLOAD route.
    downloadApp = express();
    downloadApp.set('trust proxy', true);
    downloadApp.use(
      (req: AuthorizedRequest, _res: Response, next: NextFunction) => {
        req.user = testUser;
        next();
      },
    );
    downloadApp.use(DOWNLOAD_MOUNT, downloadRouterFactory(crowi));

    // App 3 — the real attachment REMOVE handler (same wiring as the
    // activity-real-removal-response.integ.ts precedent).
    const { api } = routesFactory(crowi);
    removeApp = express();
    removeApp.set('trust proxy', true);
    removeApp.use(express.json());
    removeApp.use(
      (req: AuthorizedRequest, _res: Response, next: NextFunction) => {
        req.user = testUser;
        next();
      },
    );
    removeApp.post(
      REMOVE_ENDPOINT,
      generateAddActivityMiddleware(),
      api.remove,
    );

    // App 4 — the real apiv3 activity router (response under test).
    const { setup: setupActivity } = await import('./activity');
    const activityRouter = setupActivity(crowi);
    activityApp = express();
    activityApp.use(express.json());
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
    // Remove attachments uploaded/created by this suite through the real
    // service so the GridFS blobs are deleted along with the metadata docs.
    const remaining = await Attachment.find({ creator: testUserId });
    await Promise.all(
      remaining.map((attachment) =>
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

  it('req 8.1/8.2/8.3 — ADD, DOWNLOAD, and REMOVE activities each surface the right snapshot/target fields and are distinguishable by action', async () => {
    // Arrange + Act: a real upload (ADD)
    const fileBody = Buffer.from(
      'activity-real-add-download-response integ payload (task 13.3)',
    );
    const addRes = await postAdd(
      pageId.toString(),
      fileBody,
      'lifecycle-notes.md',
    );
    expect(addRes.status).toBe(200);
    const addedAttachmentId: string = addRes.body.data.attachment._id;
    const addSettled = await waitForActivityByTarget(
      addedAttachmentId,
      SupportedAction.ACTION_ATTACHMENT_ADD,
    );

    // Act: download the SAME attachment (DOWNLOAD)
    const downloadRes = await getDownload(addedAttachmentId);
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.text).toBe(fileBody.toString());
    const downloadSettled = await waitForActivityByTarget(
      addedAttachmentId,
      SupportedAction.ACTION_ATTACHMENT_DOWNLOAD,
    );

    // Arrange + Act: remove a DIFFERENT attachment (REMOVE) — the
    // "entity-gone" counterpart req 8.3 needs consumers to tell apart from
    // ADD/DOWNLOAD's "entity-preserved" attachments.
    const removedAttachment = await arrangeRemovableAttachment({
      originalName: 'to-be-removed.dat',
      fileSize: 999,
    });
    const removeRes = await removeAttachmentViaRealFlow(
      removedAttachment._id.toString(),
    );
    expect(removeRes.status).toBe(200);
    expect(removeRes.body.ok).toBe(true);
    const removeSettled = await waitForActivityByTarget(
      removedAttachment._id.toString(),
      SupportedAction.ACTION_ATTACHMENT_REMOVE,
    );

    // Act: fetch all three through the real apiv3 activity router in one call
    const res = await getActivityList();

    // Assert
    expect(res.status).toBe(200);
    const docs: ResponseActivityDoc[] =
      res.body.data.serializedPaginationResult.docs;
    expect(docs).toHaveLength(3);

    const addDoc = docs.find(
      (d) => d.action === SupportedAction.ACTION_ATTACHMENT_ADD,
    );
    const downloadDoc = docs.find(
      (d) => d.action === SupportedAction.ACTION_ATTACHMENT_DOWNLOAD,
    );
    const removeDoc = docs.find(
      (d) => d.action === SupportedAction.ACTION_ATTACHMENT_REMOVE,
    );
    if (addDoc == null || downloadDoc == null || removeDoc == null) {
      throw new Error(
        'expected one ADD doc, one DOWNLOAD doc, and one REMOVE doc in the response',
      );
    }

    // req 8.1 + 8.2 — ADD surfaces the four attachment fields + username
    // (values written by the real upload path, not values this test wrote to
    // the DB), plus target/targetModel so the downstream viewer can build a
    // download link.
    expect(addDoc.snapshot).toMatchObject({
      username: TEST_USERNAME,
      originalName: 'lifecycle-notes.md',
      pagePath: PAGE_PATH,
      pageId: pageId.toString(),
      fileSize: fileBody.byteLength,
    });
    expect(addDoc.target).toBe(addedAttachmentId);
    expect(addDoc.targetModel).toBe(MODEL_ATTACHMENT);
    expect(addDoc.snapshot.id).toBe(addSettled.snapshot.id);

    // req 8.1 — DOWNLOAD surfaces the same four fields, resolved at download
    // time (pagePath via a real Page.findById, not the already-loaded page
    // ADD reuses).
    expect(downloadDoc.snapshot).toMatchObject({
      username: TEST_USERNAME,
      originalName: 'lifecycle-notes.md',
      pagePath: PAGE_PATH,
      pageId: pageId.toString(),
      fileSize: fileBody.byteLength,
    });
    expect(downloadDoc.target).toBe(addedAttachmentId);
    expect(downloadDoc.targetModel).toBe(MODEL_ATTACHMENT);
    expect(downloadDoc.snapshot.id).toBe(downloadSettled.snapshot.id);

    // REMOVE reference point: same shape of fields, distinct attachment.
    expect(removeDoc.snapshot).toMatchObject({
      username: TEST_USERNAME,
      originalName: 'to-be-removed.dat',
      pagePath: PAGE_PATH,
      pageId: pageId.toString(),
      fileSize: 999,
    });
    expect(removeDoc.target).toBe(removedAttachment._id.toString());
    expect(removeDoc.targetModel).toBe(MODEL_ATTACHMENT);
    expect(removeDoc.snapshot.id).toBe(removeSettled.snapshot.id);

    // req 8.3 — with structurally-identical snapshot shapes across all
    // three, `action` alone is what lets a consumer tell them apart (and
    // decide whether a download link is appropriate: ADD/DOWNLOAD still have
    // the file, REMOVE does not).
    expect(new Set(docs.map((d) => d.action))).toEqual(
      new Set([
        SupportedAction.ACTION_ATTACHMENT_ADD,
        SupportedAction.ACTION_ATTACHMENT_DOWNLOAD,
        SupportedAction.ACTION_ATTACHMENT_REMOVE,
      ]),
    );
  });

  it('req 8.4 — a legacy username-only ATTACHMENT_DOWNLOAD row coexists with a real ATTACHMENT_ADD row in the same response without breaking it', async () => {
    // Arrange: real-flow row first…
    const fileBody = Buffer.from(
      'activity-real-add-download-response integ payload — legacy coexistence (task 13.3)',
    );
    const addRes = await postAdd(pageId.toString(), fileBody, 'fresh-notes.md');
    expect(addRes.status).toBe(200);
    const addedAttachmentId: string = addRes.body.data.attachment._id;
    await waitForActivityByTarget(
      addedAttachmentId,
      SupportedAction.ACTION_ATTACHMENT_ADD,
    );

    // …then a hand-seeded legacy row (catch-all `{ username }` snapshot, no
    // attachment fields, no target/targetModel). Hand-seeding is correct
    // here: this shape is no longer produced by any real ADD/DOWNLOAD flow
    // once this increment ships.
    await prisma.activities.create({
      data: {
        id: new Types.ObjectId().toHexString(),
        v: 0,
        action: SupportedAction.ACTION_ATTACHMENT_DOWNLOAD,
        createdAt: new Date(),
        endpoint: '/test',
        ip: TEST_IP,
        snapshot: {
          id: new Types.ObjectId().toHexString(),
          username: TEST_USERNAME,
        },
        userId: testUserId.toHexString(),
      },
    });

    // Act: one request returns both shapes
    const res = await getActivityList();

    // Assert: the mixed response is intact — both rows are returned
    expect(res.status).toBe(200);
    const docs: ResponseActivityDoc[] =
      res.body.data.serializedPaginationResult.docs;
    expect(docs).toHaveLength(2);

    const addDoc = docs.find(
      (d) => d.action === SupportedAction.ACTION_ATTACHMENT_ADD,
    );
    const legacyDoc = docs.find(
      (d) => d.action === SupportedAction.ACTION_ATTACHMENT_DOWNLOAD,
    );

    // Real-flow row: all four fields present, target/targetModel present —
    // no regression from the legacy row's presence in the same response.
    if (addDoc == null) {
      throw new Error(
        'expected the ATTACHMENT_ADD doc from the real flow in the response',
      );
    }
    expect(addDoc.snapshot).toMatchObject({
      username: TEST_USERNAME,
      originalName: 'fresh-notes.md',
      pagePath: PAGE_PATH,
      pageId: pageId.toString(),
      fileSize: fileBody.byteLength,
    });
    expect(addDoc.target).toBe(addedAttachmentId);
    expect(addDoc.targetModel).toBe(MODEL_ATTACHMENT);

    // Legacy row: username intact, attachment fields absent — no fabricated
    // values. Prisma reads missing optional composite fields back as null,
    // so accept absent (undefined) or null.
    if (legacyDoc == null) {
      throw new Error(
        'expected the legacy ATTACHMENT_DOWNLOAD doc in the response',
      );
    }
    expect(legacyDoc.snapshot.username).toBe(TEST_USERNAME);
    expect(legacyDoc.snapshot.originalName ?? null).toBeNull();
    expect(legacyDoc.snapshot.pagePath ?? null).toBeNull();
    expect(legacyDoc.snapshot.pageId ?? null).toBeNull();
    expect(legacyDoc.snapshot.fileSize ?? null).toBeNull();
    expect(legacyDoc.target ?? null).toBeNull();
    expect(legacyDoc.targetModel ?? null).toBeNull();
  });
});
