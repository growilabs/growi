/**
 * Integration tests — complete page deletion cascades one
 * ACTION_ATTACHMENT_REMOVE activity per removed attachment (task 7.2;
 * read-back-from-real-DB style).
 *
 * Path under test: the REAL pageService.deleteCompletely (v5 branch) →
 * deleteCompletelyOperation(ids, paths, { user, ip, endpoint }) →
 * recordCascadeAttachmentRemovals (BEFORE removeAllAttachments) →
 * activityService.createActivity → prisma.activities.createByParameters.
 * Preconditions satisfied for the v5 branch: app:isV5Compatible = true,
 * the page is published (not trashed), public (not restricted) and has a
 * parent (migrated); PageOperation is empty so canOperate passes.
 *
 * Every assertion READS THE ACTIVITIES BACK FROM THE REAL DATABASE:
 * createActivity (and the recorder) swallow persistence errors — a unique
 * index collision (E11000) would NOT reject deleteCompletely, it would
 * surface as a MISSING row. Asserting count === number of attachments is
 * therefore the E11000 evidence (design.md: unique index 衝突の回避 — the
 * compound unique index { userId, target, action, createdAt } stays unique
 * because target is each attachment's own _id, even within one cascade at
 * the same millisecond).
 *
 * Recording gate: injected through the explicit configManager API
 * (DB-backed updateConfigs, which getConfig prefers over env) — process.env
 * is never mutated. ACTION_ATTACHMENT_REMOVE belongs to MediumActionGroup.
 *
 * Requires a real MongoDB (wired by vitest.workspace.mts integ setup;
 * per-worker DB isolation via test/setup/mongo + test/setup/prisma).
 *
 * Requirements: 3.1, 3.3, 3.4
 * Design: Testing Strategy（完全削除で1ページ複数添付 — E11000 なし・4フィールド
 *   読み直し・pageId/pagePath 非劣化）, System Flows > カスケード削除（要件 3）,
 *   unique index 衝突の回避
 */

import type { IPage, IUserHasId } from '@growi/core';
import { PageGrant } from '@growi/core';
import mongoose, { Types } from 'mongoose';

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
import type { PageModel } from '~/server/models/page';
import { configManager } from '~/server/service/config-manager';
import { prisma } from '~/utils/prisma';

// Sentinel ip so cleanup deletes only this suite's activity rows
// (used sentinels in sibling suites: 10.0.0.70/.72/.73/.74/.75/.88/.99,
// 127.0.0.1).
const TEST_IP = '10.0.0.76';
const TEST_ENDPOINT = '/_api/v3/pages/delete-completely-cascade-integ';
const TEST_USERNAME = 'delete-completely-cascade-activity-integ-user';
const PAGE_PATH = '/delete-completely-cascade-activity-integ';

/** Distinct per-attachment snapshot sources (requirement 3.3 fields). */
const ATTACHMENT_FIXTURES = [
  { originalName: 'cascade-report.pdf', fileSize: 11111 },
  { originalName: 'cascade-diagram.png', fileSize: 22222 },
  { originalName: 'cascade-minutes.md', fileSize: 33333 },
] as const;

describe('deleteCompletely — cascade attachment removal activities (read back from DB)', () => {
  let crowi: Crowi;
  let Page: PageModel;
  // crowi.models.User is Model<any>, so the created doc is untyped; the
  // fields the deletion path reads (_id, username) are what matter.
  let testUser: IUserHasId;
  // The same user's _id in its runtime (ObjectId) form, for Mongoose refs
  // (IUserHasId types _id as string while the doc actually holds ObjectId).
  let testUserId: Types.ObjectId;

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<IPage, PageModel>('Page');

    // --- Recording gate injection (NO process.env mutation) ---
    // createActivity delegates to shoudUpdateActivity, which reads these via
    // configManager.getConfig — the DB-sourced value written by this explicit
    // API wins over env. ACTION_ATTACHMENT_REMOVE is in MediumActionGroup.
    // app:isV5Compatible steers deleteCompletely away from the v4 branch
    // (shouldUseV4Process) so the actor carries ip/endpoint.
    await configManager.updateConfigs({
      'app:auditLogEnabled': true,
      'app:auditLogActionGroupSize': ActionGroupSize.Medium,
      'app:isV5Compatible': true,
      'app:fileUploadType': AttachmentMethodType.gridfs,
    });
    // Real file-upload service: deleteCompletelyOperation runs the real
    // attachmentService.removeAllAttachments, whose gridfs deleteFiles is a
    // no-op for blobs that were never uploaded (metadata-only attachments).
    await crowi.setUpFileUpload(true);

    // Ensure the root page exists — the v5 non-recursive branch updates the
    // ancestor's descendantCount through page.parent.
    const existingRootPage = await Page.findOne({ path: '/' });
    if (existingRootPage == null) {
      await Page.create({ path: '/', grant: PageGrant.GRANT_PUBLIC });
    }

    testUser = await crowi.models.User.create({
      name: 'Delete Completely Cascade Activity Integ User',
      username: TEST_USERNAME,
      email: 'delete-completely-cascade-activity-integ@example.com',
    });
    testUserId = new Types.ObjectId(testUser._id);
  }, 120_000);

  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
    await Attachment.deleteMany({
      originalName: { $in: ATTACHMENT_FIXTURES.map((f) => f.originalName) },
    });
    await Page.deleteMany({ path: PAGE_PATH });
    await crowi.models.User.deleteMany({ username: TEST_USERNAME });
    // Remove the injected config rows so later suites in this worker's DB
    // see the pristine (env/default) values again.
    await configManager.updateConfigs(
      {
        'app:auditLogEnabled': undefined,
        'app:auditLogActionGroupSize': undefined,
        'app:isV5Compatible': undefined,
        'app:fileUploadType': undefined,
      },
      { removeIfUndefined: true },
    );
  });

  it('req 3.1/3.3/3.4 — creates one ACTION_ATTACHMENT_REMOVE activity per attachment with unique targets and the four frozen snapshot fields', async () => {
    // Arrange: a real v5 page (parent = root, published, public) holding
    // MULTIPLE real attachment docs, inserted in one batch so their creation
    // times are as close to the same millisecond as possible.
    const rootPage = await Page.findOne({ path: '/' });
    if (rootPage == null) {
      throw new Error('root page must exist (created in beforeAll)');
    }
    const [page] = await Page.insertMany([
      {
        path: PAGE_PATH,
        grant: PageGrant.GRANT_PUBLIC,
        creator: testUserId,
        lastUpdateUser: testUserId,
        parent: rootPage._id,
        status: Page.STATUS_PUBLISHED,
      },
    ]);
    const attachments = await Attachment.insertMany(
      ATTACHMENT_FIXTURES.map((fixture) => ({
        page: page._id,
        creator: testUserId,
        // fileName is globally unique — suffix with a fresh ObjectId
        fileName: `delete-completely-cascade-integ-${new Types.ObjectId().toHexString()}.dat`,
        fileFormat: 'application/octet-stream',
        fileSize: fixture.fileSize,
        originalName: fixture.originalName,
        attachmentType: AttachmentType.WIKI_PAGE,
      })),
    );

    // Act: the REAL complete-deletion path. Non-recursive v5 deleteCompletely
    // awaits deleteCompletelyOperation (which awaits the cascade recorder),
    // so every cascade activity row exists once this call resolves.
    await crowi.pageService.deleteCompletely(page, testUser, {}, false, false, {
      ip: TEST_IP,
      endpoint: TEST_ENDPOINT,
    });

    // Assert: read the cascade activities back from the real DB.
    const cascadeActivities = await prisma.activities.findMany({
      where: { ip: TEST_IP, action: SupportedAction.ACTION_ATTACHMENT_REMOVE },
    });

    // One activity per attachment. createActivity/the recorder swallow
    // persistence errors, so an E11000 collision on the unique index
    // { userId, target, action, createdAt } would NOT throw — it would leave
    // a missing row. deleteCompletely resolving + this exact count IS the
    // no-collision evidence (target differs per attachment; req 3.1).
    expect(cascadeActivities).toHaveLength(ATTACHMENT_FIXTURES.length);

    // target is each attachment's own _id — unique across the cascade.
    const targets = cascadeActivities.map((activity) => activity.target);
    expect(new Set(targets).size).toBe(ATTACHMENT_FIXTURES.length);
    expect(targets.slice().sort()).toEqual(
      attachments.map((attachment) => attachment._id.toString()).sort(),
    );

    // Each record carries the four frozen fields + username (req 3.3), and
    // pageId/pagePath did NOT degrade to null/undefined — this pins the
    // Mongoose `page` → recorder `pageId` rename (toAttachmentLikes) and the
    // pageIds/pagePaths → map lookup (buildPageIdToPathMap): a forgotten
    // rename or an ObjectId/string key mismatch would silently drop both.
    for (const attachment of attachments) {
      const activity = cascadeActivities.find(
        (row) => row.target === attachment._id.toString(),
      );
      if (activity == null) {
        throw new Error(
          `no cascade activity recorded for attachment ${attachment._id.toString()}`,
        );
      }
      expect(activity.targetModel).toBe(MODEL_ATTACHMENT);
      // The direct deleteCompletely caller passes the full actor through
      // (user + ip + endpoint); ip is already pinned by the where clause.
      expect(activity.endpoint).toBe(TEST_ENDPOINT);
      expect(activity.userId).toBe(testUser._id.toString());
      expect(activity.snapshot).toMatchObject({
        username: TEST_USERNAME,
        originalName: attachment.originalName,
        pagePath: PAGE_PATH,
        pageId: page._id.toString(),
        fileSize: attachment.fileSize,
      });
    }

    // Requirement 3.4 (freeze BEFORE the actual deletion): the attachment
    // docs and the page are really gone from the DB, yet the snapshots read
    // back above still hold the pre-deletion data — the only way that holds
    // is if the snapshot was taken before removal.
    expect(
      await Attachment.countDocuments({
        _id: { $in: attachments.map((attachment) => attachment._id) },
      }),
    ).toBe(0);
    expect(await Page.findById(page._id)).toBeNull();
  });
});
