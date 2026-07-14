/**
 * Integration tests — cascade attachment-removal activities on the two
 * bulk-deletion paths that reach deleteCompletelyOperation through the
 * deleteMultipleCompletely seam (task 7.3; read-back-from-real-DB style):
 *
 *   A. Empty trash: the REAL pageService.emptyTrashPage →
 *      deleteCompletelyDescendantsWithStream (batch stream over /trash
 *      descendants) → deleteMultipleCompletely(batch, user) →
 *      deleteCompletelyOperation(ids, paths, { user }) →
 *      recordCascadeAttachmentRemovals (BEFORE removeAllAttachments).
 *   B. Group deletion: the REAL
 *      pageService.handlePrivatePagesForGroupsToDelete(groups, 'delete', _,
 *      user) → deleteMultipleCompletely(pages, user) → same seam.
 *
 * What the seam guarantees (design: File Structure Plan > actor の受け渡し設計):
 * deleteMultipleCompletely builds the actor as `{ user }` from its own `user`
 * argument, so BOTH paths record the OPERATOR without any caller change —
 * and ip/endpoint DEGRADE (accepted): createByParameters stores them as ''
 * when absent. The fixtures deliberately use a content creator DIFFERENT
 * from the operator, so `userId === operator` pins the actor's provenance
 * to the seam's `user` argument (a creator-derived value would fail).
 *
 * Every assertion READS THE ACTIVITIES BACK FROM THE REAL DATABASE: the
 * recorder and createActivity swallow persistence errors, and the trash
 * stream's write handler additionally swallows whole-batch errors — a
 * silently-failing record surfaces only as a MISSING row.
 *
 * Recording gate: injected through the explicit configManager API
 * (DB-backed updateConfigs, which getConfig prefers over env) — process.env
 * is never mutated. ACTION_ATTACHMENT_REMOVE belongs to MediumActionGroup.
 *
 * Activity rows are filtered by target/userId, NOT by a sentinel ip —
 * on these paths ip degrades to '' so an ip filter would match nothing.
 * The sentinel ip 10.0.0.77 (unused by sibling suites: .55/.56/.57/.70-.76/
 * .88/.99, 127.0.0.1) is passed only to emptyTrashPage's activityParameters
 * to prove ip was genuinely available at the entry point (it lands on the
 * parent PAGE_RECURSIVELY_DELETE_COMPLETELY activity) yet still degrades at
 * the seam.
 *
 * Requires a real MongoDB (wired by vitest.workspace.mts integ setup;
 * per-worker DB isolation via test/setup/mongo + test/setup/prisma).
 *
 * Requirements: 3.2
 * Design: File Structure Plan > actor の受け渡し設計（deleteMultipleCompletely
 *   への収束・ip/endpoint の縮退（許容））, Testing Strategy（ゴミ箱空＋
 *   handlePrivatePagesForGroupsToDelete 1ケース）, System Flows >
 *   カスケード削除（要件 3）
 */

import type { IPage, IUserHasId } from '@growi/core';
import { GroupType, PageGrant } from '@growi/core';
import mongoose, { Types } from 'mongoose';

import { getInstance } from '^/test/setup/crowi';

import {
  ActionGroupSize,
  MODEL_ATTACHMENT,
  SupportedAction,
} from '~/interfaces/activity';
import { AttachmentMethodType } from '~/interfaces/attachment';
import { PageActionOnGroupDelete } from '~/interfaces/user-group';
import type Crowi from '~/server/crowi';
import { AttachmentType } from '~/server/interfaces/attachment';
import { Attachment } from '~/server/models/attachment';
import type { PageModel } from '~/server/models/page';
import UserGroup from '~/server/models/user-group';
import { configManager } from '~/server/service/config-manager';
import PageService from '~/server/service/page';
import { prisma } from '~/utils/prisma';

const TRASH_OPERATOR_USERNAME = 'empty-trash-cascade-activity-integ-operator';
const GROUP_OPERATOR_USERNAME = 'group-delete-cascade-activity-integ-operator';
const CREATOR_USERNAME = 'trash-group-cascade-activity-integ-creator';

const TRASH_PAGE_PATH = '/trash/empty-trash-cascade-activity-integ';
const GROUP_PAGE_PATH = '/group-delete-cascade-activity-integ';
const GROUP_NAME = 'group-delete-cascade-activity-integ-group';

// Passed to emptyTrashPage's activityParameters only — see header comment.
const TRASH_ENTRY_IP = '10.0.0.77';
const TRASH_ENTRY_ENDPOINT = '/_api/v3/pages/empty-trash-cascade-integ';

/** Distinct per-attachment snapshot sources (requirement 3.3 fields). */
const TRASH_ATTACHMENT_FIXTURES = [
  { originalName: 'trash-report.pdf', fileSize: 41111 },
  { originalName: 'trash-photo.png', fileSize: 42222 },
] as const;
const GROUP_ATTACHMENT_FIXTURE = {
  originalName: 'group-secret.docx',
  fileSize: 53333,
} as const;

describe('cascade attachment-removal activities through the deleteMultipleCompletely seam (read back from DB)', () => {
  let crowi: Crowi;
  // The concrete service: emptyTrashPage is not part of the IPageService
  // interface (its only production caller is the untyped apiv3 route), so
  // crowi.pageService is narrowed to the implementation class below.
  let pageService: PageService;
  let Page: PageModel;
  // crowi.models.User is Model<any>, so the created docs are untyped; the
  // fields the deletion paths read (_id, username) are what matter.
  let trashOperator: IUserHasId;
  let groupOperator: IUserHasId;
  let contentCreator: IUserHasId;
  // The creator's _id in its runtime (ObjectId) form, for Mongoose refs
  // (IUserHasId types _id as string while the doc actually holds ObjectId).
  let contentCreatorId: Types.ObjectId;

  const createdAttachmentIds: Types.ObjectId[] = [];

  /** Create a metadata-only attachment doc and register it for cleanup. */
  async function arrangeAttachment(overrides: {
    page: Types.ObjectId;
    originalName: string;
    fileSize: number;
  }) {
    const attachment = await Attachment.create({
      page: overrides.page,
      creator: contentCreatorId,
      // fileName is globally unique — suffix with a fresh ObjectId
      fileName: `trash-group-cascade-activity-integ-${new Types.ObjectId().toHexString()}.dat`,
      fileFormat: 'application/octet-stream',
      fileSize: overrides.fileSize,
      originalName: overrides.originalName,
      attachmentType: AttachmentType.WIKI_PAGE,
    });
    createdAttachmentIds.push(attachment._id);
    return attachment;
  }

  async function deleteThisSuitesActivities() {
    await prisma.activities.deleteMany({
      where: {
        userId: {
          in: [trashOperator._id.toString(), groupOperator._id.toString()],
        },
      },
    });
  }

  beforeAll(async () => {
    crowi = await getInstance();
    Page = mongoose.model<IPage, PageModel>('Page');

    if (!(crowi.pageService instanceof PageService)) {
      throw new Error(
        'crowi.pageService is expected to be the concrete PageService',
      );
    }
    pageService = crowi.pageService;

    // --- Recording gate injection (NO process.env mutation) ---
    // createActivity delegates to shoudUpdateActivity, which reads these via
    // configManager.getConfig — the DB-sourced value written by this explicit
    // API wins over env. ACTION_ATTACHMENT_REMOVE is in MediumActionGroup.
    // (app:isV5Compatible is NOT needed: neither emptyTrashPage nor
    // handlePrivatePagesForGroupsToDelete goes through shouldUseV4Process.)
    await configManager.updateConfigs({
      'app:auditLogEnabled': true,
      'app:auditLogActionGroupSize': ActionGroupSize.Medium,
      'app:fileUploadType': AttachmentMethodType.gridfs,
    });
    // Real file-upload service: deleteCompletelyOperation runs the real
    // attachmentService.removeAllAttachments, whose gridfs deleteFiles is a
    // no-op for blobs that were never uploaded (metadata-only attachments).
    await crowi.setUpFileUpload(true);

    // Ensure the root page exists — the group-deletion fixture page sits on
    // the v5 tree (parent = root) like a real private page.
    const existingRootPage = await Page.findOne({ path: '/' });
    if (existingRootPage == null) {
      await Page.create({ path: '/', grant: PageGrant.GRANT_PUBLIC });
    }

    // Creator ≠ operator on purpose: the userId assertions below then prove
    // the recorded actor comes from the seam's `user` argument, not from any
    // document field (see header comment).
    [trashOperator, groupOperator, contentCreator] = await Promise.all([
      crowi.models.User.create({
        name: 'Empty Trash Cascade Activity Integ Operator',
        username: TRASH_OPERATOR_USERNAME,
        email: 'empty-trash-cascade-activity-integ@example.com',
      }),
      crowi.models.User.create({
        name: 'Group Delete Cascade Activity Integ Operator',
        username: GROUP_OPERATOR_USERNAME,
        email: 'group-delete-cascade-activity-integ@example.com',
      }),
      crowi.models.User.create({
        name: 'Trash Group Cascade Activity Integ Creator',
        username: CREATOR_USERNAME,
        email: 'trash-group-cascade-activity-integ-creator@example.com',
      }),
    ]);
    contentCreatorId = new Types.ObjectId(contentCreator._id);
  }, 120_000);

  beforeEach(async () => {
    await deleteThisSuitesActivities();
  });

  afterAll(async () => {
    await deleteThisSuitesActivities();
    await Attachment.deleteMany({ _id: { $in: createdAttachmentIds } });
    await Page.deleteMany({
      path: { $in: [TRASH_PAGE_PATH, GROUP_PAGE_PATH] },
    });
    await UserGroup.deleteMany({ name: GROUP_NAME });
    await crowi.models.User.deleteMany({
      username: {
        $in: [
          TRASH_OPERATOR_USERNAME,
          GROUP_OPERATOR_USERNAME,
          CREATOR_USERNAME,
        ],
      },
    });
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

  describe('emptyTrashPage (empty trash)', () => {
    it('req 3.2 — creates one ACTION_ATTACHMENT_REMOVE activity per trashed attachment, recorded for the OPERATOR with the four snapshot fields + username; ip/endpoint degrade to ""', async () => {
      // Arrange: a real trashed page (path under /trash, off-tree, public —
      // exactly what generateReadStreamToOperateOnlyDescendants('/trash')
      // picks up) holding multiple real attachment docs. Its creator is NOT
      // the operator who empties the trash.
      const [trashedPage] = await Page.insertMany([
        {
          path: TRASH_PAGE_PATH,
          grant: PageGrant.GRANT_PUBLIC,
          creator: contentCreatorId,
          lastUpdateUser: contentCreatorId,
          parent: null,
          status: Page.STATUS_DELETED,
        },
      ]);
      const attachments = await Promise.all(
        TRASH_ATTACHMENT_FIXTURES.map((fixture) =>
          arrangeAttachment({ page: trashedPage._id, ...fixture }),
        ),
      );
      const attachmentIds = attachments.map((attachment) =>
        attachment._id.toString(),
      );

      // Act: the REAL empty-trash entry point, called with the full
      // activityParameters its production caller (apiv3 empty-trash route)
      // provides — proving below that ip/endpoint were available here yet
      // do not survive the deleteMultipleCompletely seam.
      await pageService.emptyTrashPage(
        trashOperator,
        {},
        {
          ip: TRASH_ENTRY_IP,
          endpoint: TRASH_ENTRY_ENDPOINT,
        },
      );

      // Assert: read the cascade activities back from the real DB. The
      // stream's write handler swallows batch errors, so a failed record
      // surfaces only as a missing row — poll via vi.waitFor. Rows are
      // pinned by target (this suite's attachment ids), which keeps the
      // count exact even if this worker's DB held other leftover trash.
      const cascadeActivities = await vi.waitFor(
        async () => {
          const rows = await prisma.activities.findMany({
            where: {
              action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
              target: { in: attachmentIds },
            },
          });
          // One activity per attachment (req 3.2); exactly one per target
          // is asserted per-attachment below.
          expect(rows).toHaveLength(TRASH_ATTACHMENT_FIXTURES.length);
          return rows;
        },
        { timeout: 5000, interval: 50 },
      );

      for (const attachment of attachments) {
        const rowsForTarget = cascadeActivities.filter(
          (row) => row.target === attachment._id.toString(),
        );
        expect(rowsForTarget).toHaveLength(1);
        const activity = rowsForTarget[0];

        expect(activity.targetModel).toBe(MODEL_ATTACHMENT);
        // Operator pass-through at the seam: the actor is the user who
        // emptied the trash — not the page/attachment creator.
        expect(activity.userId).toBe(trashOperator._id.toString());
        expect(activity.userId).not.toBe(contentCreator._id.toString());
        // The four frozen fields + the OPERATOR's username (req 3.2/3.3).
        expect(activity.snapshot).toMatchObject({
          username: TRASH_OPERATOR_USERNAME,
          originalName: attachment.originalName,
          pagePath: TRASH_PAGE_PATH,
          pageId: trashedPage._id.toString(),
          fileSize: attachment.fileSize,
        });
        // Accepted degradation (design: ip/endpoint の縮退): the actor at
        // the seam carries only `user`, and createByParameters stores the
        // missing ip/endpoint as '' — measured, exact values.
        expect(activity.ip).toBe('');
        expect(activity.endpoint).toBe('');
      }

      // The degradation is real, not an artifact of the caller lacking
      // ip/endpoint: the parent empty-trash activity created at the entry
      // point DID persist the very ip/endpoint this test passed in.
      const parentActivity = await prisma.activities.findFirst({
        where: {
          userId: trashOperator._id.toString(),
          action: SupportedAction.ACTION_PAGE_RECURSIVELY_DELETE_COMPLETELY,
        },
      });
      expect(parentActivity?.ip).toBe(TRASH_ENTRY_IP);
      expect(parentActivity?.endpoint).toBe(TRASH_ENTRY_ENDPOINT);

      // The real deletion completed: attachment docs and the trashed page
      // are gone, while the snapshots read back above still hold the
      // pre-deletion data (freeze-before-removal, req 3.4 upstream).
      expect(
        await Attachment.countDocuments({
          _id: { $in: attachments.map((attachment) => attachment._id) },
        }),
      ).toBe(0);
      expect(await Page.findById(trashedPage._id)).toBeNull();
    }, 30_000);
  });

  describe('handlePrivatePagesForGroupsToDelete (group deletion → complete deletion of private pages)', () => {
    it('req 3.2 — records one ACTION_ATTACHMENT_REMOVE activity for the group-granted page attachment, with the OPERATOR passed through the deleteMultipleCompletely seam', async () => {
      // Arrange: a real user group, a page granted ONLY to that group
      // (on the v5 tree, created by someone other than the operator), and
      // one real attachment doc on it.
      const group = await UserGroup.create({ name: GROUP_NAME });
      const rootPage = await Page.findOne({ path: '/' });
      if (rootPage == null) {
        throw new Error('root page must exist (created in beforeAll)');
      }
      const [privatePage] = await Page.insertMany([
        {
          path: GROUP_PAGE_PATH,
          grant: PageGrant.GRANT_USER_GROUP,
          grantedGroups: [{ item: group._id, type: GroupType.userGroup }],
          creator: contentCreatorId,
          lastUpdateUser: contentCreatorId,
          parent: rootPage._id,
          status: Page.STATUS_PUBLISHED,
        },
      ]);
      const attachment = await arrangeAttachment({
        page: privatePage._id,
        ...GROUP_ATTACHMENT_FIXTURE,
      });

      // Act: the REAL group-deletion page handler with action 'delete'.
      // It resolves only after deleteMultipleCompletely (and therefore the
      // awaited cascade recorder) has finished — no stream in this path.
      await pageService.handlePrivatePagesForGroupsToDelete(
        [group],
        PageActionOnGroupDelete.delete,
        undefined,
        groupOperator,
      );

      // Assert: read the cascade activity back from the real DB.
      const cascadeActivities = await prisma.activities.findMany({
        where: {
          action: SupportedAction.ACTION_ATTACHMENT_REMOVE,
          target: attachment._id.toString(),
        },
      });
      expect(cascadeActivities).toHaveLength(1);
      const activity = cascadeActivities[0];

      expect(activity.targetModel).toBe(MODEL_ATTACHMENT);
      // Operator pass-through at the seam (the point of this case): the
      // recorded actor is the user who deleted the GROUP — the page and
      // attachment belong to a different creator, so this equality can
      // only come from deleteMultipleCompletely's own `user` argument.
      expect(activity.userId).toBe(groupOperator._id.toString());
      expect(activity.userId).not.toBe(contentCreator._id.toString());
      // The four frozen fields + the OPERATOR's username (req 3.2/3.3).
      expect(activity.snapshot).toMatchObject({
        username: GROUP_OPERATOR_USERNAME,
        originalName: GROUP_ATTACHMENT_FIXTURE.originalName,
        pagePath: GROUP_PAGE_PATH,
        pageId: privatePage._id.toString(),
        fileSize: GROUP_ATTACHMENT_FIXTURE.fileSize,
      });
      // Accepted degradation: this path never had ip/endpoint (the group
      // route passes only the user), stored as '' by createByParameters.
      expect(activity.ip).toBe('');
      expect(activity.endpoint).toBe('');

      // The real deletion completed: the attachment doc and the private
      // page are gone from the DB.
      expect(await Attachment.findById(attachment._id)).toBeNull();
      expect(await Page.findById(privatePage._id)).toBeNull();
    }, 30_000);
  });
});
