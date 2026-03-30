import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';

import { SupportedAction } from '~/interfaces/activity';
import Activity from '~/server/models/activity';
import { Revision } from '~/server/models/revision';

import { shouldGenerateUpdate } from './update-activity-logic';

describe('shouldGenerateUpdate()', () => {
  let mongoServer: MongoMemoryServer;

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
});
