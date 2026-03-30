import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';

import { SupportedAction } from '~/interfaces/activity';
import Activity from '~/server/models/activity';
import { Revision } from '~/server/models/revision';

import { shouldGenerateUpdate } from './update-activity-logic';

describe('shouldGenerateUpdate()', () => {
  let mongoServer: MongoMemoryServer;
  const ONE_HOUR = 60 * 60 * 1000;
  const date = new Date();

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
  });

  it('should generate update activity if latest update is by another user', async () => {
    const currentUserId = new mongoose.Types.ObjectId().toString();
    const otherUserId = new mongoose.Types.ObjectId().toString();
    const targetPageId = new mongoose.Types.ObjectId().toString();

    const currentActivityId = new mongoose.Types.ObjectId().toString();
    const olderActivityId = new mongoose.Types.ObjectId().toString();

    await Activity.insertMany([
      {
        user: currentUserId,
        action: SupportedAction.ACTION_PAGE_CREATE,
        createdAt: new Date('2025-10-31T23:59:59Z'),
        target: targetPageId,
        _id: currentActivityId,
      },
      {
        user: otherUserId,
        action: SupportedAction.ACTION_PAGE_CREATE,
        createdAt: new Date('2025-10-30T23:59:59Z'),
        target: targetPageId,
        _id: olderActivityId,
      },
    ]);

    const result = await shouldGenerateUpdate({
      targetPageId,
      currentUserId,
      currentActivityId,
    });

    expect(result).toBe(true);
  });

  it('should not generate update activity if it is the first update activity by the creator', async () => {
    const currentUserId = new mongoose.Types.ObjectId().toString();
    const targetPageId = new mongoose.Types.ObjectId().toString();
    const currentActivityId = new mongoose.Types.ObjectId().toString();
    const olderActivityId = new mongoose.Types.ObjectId().toString();

    await Activity.insertMany([
      {
        user: currentUserId,
        action: SupportedAction.ACTION_PAGE_CREATE,
        createdAt: new Date(date.getTime() - ONE_HOUR),
        target: targetPageId,
        _id: olderActivityId,
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
      targetPageId,
      currentUserId,
      currentActivityId,
    });

    expect(result).toBe(false);
  });
});
