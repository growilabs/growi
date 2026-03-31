import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';

import { SupportedAction } from '~/interfaces/activity';
import Activity from '~/server/models/activity';
import { Revision } from '~/server/models/revision';

import { shouldGenerateUpdate } from './update-activity-logic';

describe('shouldGenerateUpdate()', () => {
  let mongoServer: MongoMemoryServer;

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

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Activity.deleteMany({});
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

  it('should generate update activity if: latest update is by another user, not first update', async () => {
    await Activity.insertMany([
      // Create activity
      {
        user: currentUserId,
        action: SupportedAction.ACTION_PAGE_CREATE,
        createdAt: new Date(date.getTime() - TWO_HOURS),
        target: targetPageId,
        _id: createActivityId,
      },
      // Latest activity
      {
        user: otherUserId,
        action: SupportedAction.ACTION_PAGE_UPDATE,
        createdAt: new Date(date.getTime() - ONE_HOUR),
        target: targetPageId,
        _id: olderActivityId,
      },
      // Current activity
      {
        user: currentUserId,
        action: SupportedAction.ACTION_PAGE_UPDATE,
        createdAt: new Date(),
        target: targetPageId,
        _id: currentActivityId,
      },
    ]);

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
    await Activity.insertMany([
      {
        user: otherUserId,
        action: SupportedAction.ACTION_PAGE_CREATE,
        createdAt: new Date(date.getTime() - TWO_HOURS),
        target: targetPageId,
        _id: createActivityId,
      },
      {
        user: currentUserId,
        action: SupportedAction.ACTION_PAGE_UPDATE,
        createdAt: new Date(),
        target: targetPageId,
        _id: currentActivityId,
      },
    ]);

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

  it('should not generate update activity if: update is made by the page creator, first update', async () => {
    await Activity.insertMany([
      {
        user: currentUserId,
        action: SupportedAction.ACTION_PAGE_CREATE,
        createdAt: new Date(date.getTime() - ONE_HOUR),
        target: targetPageId,
        _id: createActivityId,
      },
      {
        user: currentUserId,
        action: SupportedAction.ACTION_PAGE_UPDATE,
        createdAt: new Date(),
        target: targetPageId,
        _id: currentActivityId,
      },
    ]);

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

  it('should generate update activity if: update is by the same user, outside the suppression window, not first update', async () => {
    await Activity.insertMany([
      {
        user: currentUserId,
        action: SupportedAction.ACTION_PAGE_CREATE,
        createdAt: new Date(date.getTime() - ONE_HOUR),
        target: targetPageId,
        _id: createActivityId,
      },
      {
        user: currentUserId,
        action: SupportedAction.ACTION_PAGE_UPDATE,
        createdAt: new Date(),
        target: targetPageId,
        _id: currentActivityId,
      },
    ]);

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

  it('should not generate update activity if: update is made by the same user, within suppression window, not first update', async () => {
    await Activity.insertMany([
      {
        user: currentUserId,
        action: SupportedAction.ACTION_PAGE_CREATE,
        createdAt: new Date(date.getTime() - ONE_MINUTE),
        target: targetPageId,
        _id: createActivityId,
      },
      {
        user: currentUserId,
        action: SupportedAction.ACTION_PAGE_UPDATE,
        createdAt: new Date(),
        target: targetPageId,
        _id: currentActivityId,
      },
    ]);

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
    await Activity.insertMany([
      {
        user: currentUserId,
        action: SupportedAction.ACTION_PAGE_CREATE,
        createdAt: new Date(date.getTime() - ONE_HOUR),
        target: targetPageId,
        _id: createActivityId,
      },
      {
        user: currentUserId,
        action: SupportedAction.ACTION_PAGE_UPDATE,
        createdAt: new Date(),
        target: targetPageId,
        _id: currentActivityId,
      },
    ]);

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
});
