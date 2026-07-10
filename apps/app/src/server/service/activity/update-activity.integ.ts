/**
 * Integration tests — shouldGenerateUpdate real-DB end-to-end (Prisma read path).
 *
 * `shouldGenerateUpdate` now reads via `prisma.activities.findFirst` (migrated in
 * task 3.4).  These tests seed activities via `prisma.activities.createMany` into
 * the same per-worker test DB that the integration `prisma` setup
 * (`test/setup/prisma.ts`) binds the Prisma client to, then assert that all 8
 * observable update-suppression scenarios produce the correct boolean outcome.
 *
 * Revision records are kept as Mongoose `Revision.insertMany` because the Revision
 * model has NOT been migrated to Prisma; in the integration project Mongoose and
 * Prisma share the same DB, so the `revisionCount` path in `shouldGenerateUpdate`
 * still works correctly.
 *
 * Requires a real MongoDB connection (wired by vitest.workspace.mts integ setup).
 * These tests CANNOT run locally (no mongod binary / egress 403).
 * The local bar is: type-checks cleanly; CI (external MONGO_URI) exercises actual DB.
 *
 * Requirements: 1.2, 5.3
 * Design: Testing Strategy ("既存の integ テスト（update-activity.spec…）は
 *   insertMany→createMany／find→executor へ追随")
 * Precedent: task 6.2 contribution-graph integ conversions; activity-phase1.integ.ts
 */

import mongoose, { Types } from 'mongoose';

import { SupportedAction } from '~/interfaces/activity';
import { Revision } from '~/server/models/revision';
import { prisma } from '~/utils/prisma';

import { shouldGenerateUpdate } from './update-activity-logic';

// A sentinel ip value so cleanup deletes only this suite's rows.
const TEST_IP = '10.0.0.88';

/** Build a minimal activities record for seeding via prisma.activities.createMany. */
function makeActivityData(overrides: {
  id: string;
  userId: string;
  action: string;
  createdAt: Date;
  target: string;
}) {
  return {
    id: overrides.id,
    v: 0,
    action: overrides.action,
    createdAt: overrides.createdAt,
    endpoint: '/test/update-activity',
    ip: TEST_IP,
    snapshot: { id: new Types.ObjectId().toHexString(), username: 'testuser' },
    userId: overrides.userId,
    target: overrides.target,
  };
}

describe('shouldGenerateUpdate()', () => {
  let date = new Date();
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const ONE_HOUR = 60 * 60 * 1000;
  const ONE_MINUTE = 1 * 60 * 1000;

  let targetPageId: mongoose.Types.ObjectId;
  let currentUserId: mongoose.Types.ObjectId;
  let otherUserId: mongoose.Types.ObjectId;
  let currentActivityId: mongoose.Types.ObjectId;
  let olderActivityId: mongoose.Types.ObjectId;
  let createActivityId: mongoose.Types.ObjectId;

  let targetPageIdStr: string;
  let currentUserIdStr: string;
  let currentActivityIdStr: string;

  beforeEach(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
    await Revision.deleteMany({});

    // Reset date and IDs between tests
    date = new Date();
    targetPageId = new mongoose.Types.ObjectId();
    currentUserId = new mongoose.Types.ObjectId();
    otherUserId = new mongoose.Types.ObjectId();
    currentActivityId = new mongoose.Types.ObjectId();
    olderActivityId = new mongoose.Types.ObjectId();
    createActivityId = new mongoose.Types.ObjectId();

    targetPageIdStr = targetPageId.toString();
    currentUserIdStr = currentUserId.toString();
    currentActivityIdStr = currentActivityId.toString();
  });

  afterAll(async () => {
    await prisma.activities.deleteMany({ where: { ip: TEST_IP } });
    await Revision.deleteMany({});
  });

  it('should not generate update activity if: a create was performed but no update made', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({
          id: createActivityId.toHexString(),
          userId: currentUserId.toHexString(),
          action: SupportedAction.ACTION_PAGE_CREATE,
          createdAt: new Date(date.getTime() - TWO_HOURS),
          target: targetPageIdStr,
        }),
      ],
    });

    await Revision.insertMany([
      {
        _id: new mongoose.Types.ObjectId(),
        pageId: targetPageId,
        body: 'Old content',
        format: 'markdown',
        author: currentUserId,
      },
    ]);

    const result = await shouldGenerateUpdate({
      targetPageId: targetPageIdStr,
      currentUserId: currentUserIdStr,
      currentActivityId: currentActivityIdStr,
    });

    expect(result).toBe(false);
  });

  it('should generate update activity if: latest update is by another user, not first update', async () => {
    await prisma.activities.createMany({
      data: [
        // Create activity
        makeActivityData({
          id: createActivityId.toHexString(),
          userId: currentUserId.toHexString(),
          action: SupportedAction.ACTION_PAGE_CREATE,
          createdAt: new Date(date.getTime() - TWO_HOURS),
          target: targetPageIdStr,
        }),
        // Latest activity
        makeActivityData({
          id: olderActivityId.toHexString(),
          userId: otherUserId.toHexString(),
          action: SupportedAction.ACTION_PAGE_UPDATE,
          createdAt: new Date(date.getTime() - ONE_HOUR),
          target: targetPageIdStr,
        }),
        // Current activity
        makeActivityData({
          id: currentActivityId.toHexString(),
          userId: currentUserId.toHexString(),
          action: SupportedAction.ACTION_PAGE_UPDATE,
          createdAt: new Date(),
          target: targetPageIdStr,
        }),
      ],
    });

    // More than 2 revisions means it is NOT the first update
    await Revision.insertMany([
      {
        _id: new mongoose.Types.ObjectId(),
        pageId: targetPageId,
        body: 'Old content',
        format: 'markdown',
        author: currentUserId,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        pageId: targetPageId,
        body: 'Old content',
        format: 'markdown',
        author: currentUserId,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        pageId: targetPageId,
        body: 'Newer content',
        format: 'markdown',
        author: currentUserId,
      },
    ]);

    const result = await shouldGenerateUpdate({
      targetPageId: targetPageIdStr,
      currentUserId: currentUserIdStr,
      currentActivityId: currentActivityIdStr,
    });

    expect(result).toBe(true);
  });

  it('should generate update activity if: page created by another user, first update', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({
          id: createActivityId.toHexString(),
          userId: otherUserId.toHexString(),
          action: SupportedAction.ACTION_PAGE_CREATE,
          createdAt: new Date(date.getTime() - TWO_HOURS),
          target: targetPageIdStr,
        }),
        makeActivityData({
          id: currentActivityId.toHexString(),
          userId: currentUserId.toHexString(),
          action: SupportedAction.ACTION_PAGE_UPDATE,
          createdAt: new Date(),
          target: targetPageIdStr,
        }),
      ],
    });

    await Revision.insertMany([
      {
        _id: new mongoose.Types.ObjectId(),
        pageId: targetPageId,
        body: 'Old content',
        format: 'markdown',
        author: currentUserId,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        pageId: targetPageId,
        body: 'Old content',
        format: 'markdown',
        author: currentUserId,
      },
    ]);

    const result = await shouldGenerateUpdate({
      targetPageId: targetPageIdStr,
      currentUserId: currentUserIdStr,
      currentActivityId: currentActivityIdStr,
    });
    expect(result).toBe(true);
  });

  it('should not generate update activity if: update is made by the page creator, outside suppression window, first update', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({
          id: createActivityId.toHexString(),
          userId: currentUserId.toHexString(),
          action: SupportedAction.ACTION_PAGE_CREATE,
          createdAt: new Date(date.getTime() - ONE_HOUR),
          target: targetPageIdStr,
        }),
        makeActivityData({
          id: currentActivityId.toHexString(),
          userId: currentUserId.toHexString(),
          action: SupportedAction.ACTION_PAGE_UPDATE,
          createdAt: new Date(),
          target: targetPageIdStr,
        }),
      ],
    });

    await Revision.insertMany([
      {
        _id: new mongoose.Types.ObjectId(),
        pageId: targetPageId,
        body: 'Old content',
        format: 'markdown',
        author: currentUserId,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        pageId: targetPageId,
        body: 'Newer content',
        format: 'markdown',
        author: currentUserId,
      },
    ]);

    const result = await shouldGenerateUpdate({
      targetPageId: targetPageIdStr,
      currentUserId: currentUserIdStr,
      currentActivityId: currentActivityIdStr,
    });

    expect(result).toBe(false);
  });

  it('should not generate update activity if: update is made by the page creator, within suppression window, first update', async () => {
    await prisma.activities.createMany({
      data: [
        makeActivityData({
          id: createActivityId.toHexString(),
          userId: currentUserId.toHexString(),
          action: SupportedAction.ACTION_PAGE_CREATE,
          createdAt: new Date(date.getTime() - ONE_MINUTE),
          target: targetPageIdStr,
        }),
        makeActivityData({
          id: currentActivityId.toHexString(),
          userId: currentUserId.toHexString(),
          action: SupportedAction.ACTION_PAGE_UPDATE,
          createdAt: new Date(),
          target: targetPageIdStr,
        }),
      ],
    });

    await Revision.insertMany([
      {
        _id: new mongoose.Types.ObjectId(),
        pageId: targetPageId,
        body: 'Old content',
        format: 'markdown',
        author: currentUserId,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        pageId: targetPageId,
        body: 'Newer content',
        format: 'markdown',
        author: currentUserId,
      },
    ]);

    const result = await shouldGenerateUpdate({
      targetPageId: targetPageIdStr,
      currentUserId: currentUserIdStr,
      currentActivityId: currentActivityIdStr,
    });

    expect(result).toBe(false);
  });

  it('should not generate update activity if: update is made by the same user, within suppression window, not first update', async () => {
    const FOUR_MINUTES = 4 * 60 * 1000;
    await prisma.activities.createMany({
      data: [
        makeActivityData({
          id: createActivityId.toHexString(),
          userId: currentUserId.toHexString(),
          action: SupportedAction.ACTION_PAGE_CREATE,
          createdAt: new Date(date.getTime() - TWO_HOURS),
          target: targetPageIdStr,
        }),
        makeActivityData({
          id: olderActivityId.toHexString(),
          userId: currentUserId.toHexString(),
          action: SupportedAction.ACTION_PAGE_UPDATE,
          createdAt: new Date(date.getTime() - FOUR_MINUTES),
          target: targetPageIdStr,
        }),
        makeActivityData({
          id: currentActivityId.toHexString(),
          userId: currentUserId.toHexString(),
          action: SupportedAction.ACTION_PAGE_UPDATE,
          createdAt: new Date(),
          target: targetPageIdStr,
        }),
      ],
    });

    await Revision.insertMany([
      {
        _id: new mongoose.Types.ObjectId(),
        pageId: targetPageId,
        body: 'Old content',
        format: 'markdown',
        author: currentUserId,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        pageId: targetPageId,
        body: 'Old content',
        format: 'markdown',
        author: currentUserId,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        pageId: targetPageId,
        body: 'Newer content',
        format: 'markdown',
        author: currentUserId,
      },
    ]);

    const result = await shouldGenerateUpdate({
      targetPageId: targetPageIdStr,
      currentUserId: currentUserIdStr,
      currentActivityId: currentActivityIdStr,
    });

    expect(result).toBe(false);
  });

  it('should generate update activity if: update is made by the same user, outside suppression window, not first update', async () => {
    const SIX_MINUTES = 6 * 60 * 1000;
    await prisma.activities.createMany({
      data: [
        makeActivityData({
          id: createActivityId.toHexString(),
          userId: currentUserId.toHexString(),
          action: SupportedAction.ACTION_PAGE_CREATE,
          createdAt: new Date(date.getTime() - TWO_HOURS),
          target: targetPageIdStr,
        }),
        makeActivityData({
          id: olderActivityId.toHexString(),
          userId: currentUserId.toHexString(),
          action: SupportedAction.ACTION_PAGE_UPDATE,
          createdAt: new Date(date.getTime() - SIX_MINUTES),
          target: targetPageIdStr,
        }),
        makeActivityData({
          id: currentActivityId.toHexString(),
          userId: currentUserId.toHexString(),
          action: SupportedAction.ACTION_PAGE_UPDATE,
          createdAt: new Date(),
          target: targetPageIdStr,
        }),
      ],
    });

    await Revision.insertMany([
      {
        _id: new mongoose.Types.ObjectId(),
        pageId: targetPageId,
        body: 'Old content',
        format: 'markdown',
        author: currentUserId,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        pageId: targetPageId,
        body: 'Old content',
        format: 'markdown',
        author: currentUserId,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        pageId: targetPageId,
        body: 'Newer content',
        format: 'markdown',
        author: currentUserId,
      },
    ]);

    const result = await shouldGenerateUpdate({
      targetPageId: targetPageIdStr,
      currentUserId: currentUserIdStr,
      currentActivityId: currentActivityIdStr,
    });

    expect(result).toBe(true);
  });

  it('should not care about edits on other pages', async () => {
    const otherPageId = new mongoose.Types.ObjectId();

    await prisma.activities.createMany({
      data: [
        // Create page
        makeActivityData({
          id: createActivityId.toHexString(),
          userId: currentUserId.toHexString(),
          action: SupportedAction.ACTION_PAGE_CREATE,
          createdAt: new Date(date.getTime() - ONE_HOUR),
          target: targetPageIdStr,
        }),
        // Update other page
        makeActivityData({
          id: new mongoose.Types.ObjectId().toHexString(),
          userId: currentUserId.toHexString(),
          action: SupportedAction.ACTION_PAGE_UPDATE,
          createdAt: new Date(date.getTime() - ONE_MINUTE),
          target: otherPageId.toHexString(),
        }),
        // Update previously created page
        makeActivityData({
          id: currentActivityId.toHexString(),
          userId: currentUserId.toHexString(),
          action: SupportedAction.ACTION_PAGE_UPDATE,
          createdAt: new Date(),
          target: targetPageIdStr,
        }),
      ],
    });

    await Revision.insertMany([
      {
        _id: new mongoose.Types.ObjectId(),
        pageId: targetPageId,
        body: 'Old content',
        format: 'markdown',
        author: currentUserId,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        pageId: targetPageId,
        body: 'Newer content',
        format: 'markdown',
        author: currentUserId,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        pageId: targetPageId,
        body: 'Newer content',
        format: 'markdown',
        author: currentUserId,
      },
    ]);

    const result = await shouldGenerateUpdate({
      targetPageId: targetPageIdStr,
      currentUserId: currentUserIdStr,
      currentActivityId: currentActivityIdStr,
    });

    expect(result).toBe(true);
  });
});
