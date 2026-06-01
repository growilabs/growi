import type { Request } from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import mongoose from 'mongoose';
import { mockClear, mockDeep } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { configManager } from '~/server/service/config-manager';

import * as ContributionService from '../services/contribution-service';
import { getContributionsHandler } from './get-contributions';

vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig: vi.fn() },
}));
vi.mocked(configManager.getConfig).mockReturnValue(2592000);

// Register a minimal User schema. Guarded against duplicate registration if
// another spec in the same process registered it first.
if (mongoose.models.User == null) {
  mongoose.model(
    'User',
    new mongoose.Schema({ contributionsMigratedAt: { type: Date } }),
  );
}
const User = mongoose.model('User');

describe('getContributionsHandler', () => {
  const mockCrowi = mockDeep<Crowi>();
  const mockRes = mockDeep<ApiV3Response>();
  const targetUserId = new mongoose.Types.ObjectId();

  let mongod: MongoMemoryServer;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    mockClear(mockRes);
    await User.deleteMany({});
  });

  it('should return 200 and fallback graph when service fails', async () => {
    await User.create({
      _id: targetUserId,
      contributionsMigratedAt: new Date(),
    });
    const mainHandler = getContributionsHandler(mockCrowi);
    const mockReq = mockDeep<Request>({
      query: { targetUserId: targetUserId.toString() },
    });

    // Inject failure: testing the contract "if service fails, return fallback".
    vi.spyOn(ContributionService, 'getContributions').mockRejectedValue(
      new Error('DB failure'),
    );

    await mainHandler(mockReq, mockRes, () => {});

    expect(mockRes.apiv3).toHaveBeenCalledWith(
      expect.objectContaining({
        isTemporaryUnavailable: true,
        contributions: expect.any(Array),
      }),
    );
    const responseData = mockRes.apiv3.mock.calls[0][0];
    expect(responseData.contributions).toHaveLength(365);
  });

  it('should return contribution data with isMigrationInProgress=false for migrated users', async () => {
    await User.create({
      _id: targetUserId,
      contributionsMigratedAt: new Date(),
    });
    const mainHandler = getContributionsHandler(mockCrowi);
    const mockReq = mockDeep<Request>({
      query: { targetUserId: targetUserId.toString() },
    });

    const serviceResponse = {
      contributions: [{ date: '2026-04-20', count: 5 }],
    };
    vi.spyOn(ContributionService, 'getContributions').mockResolvedValue(
      serviceResponse,
    );

    await mainHandler(mockReq, mockRes, () => {});

    expect(mockRes.apiv3).toHaveBeenCalledWith(
      expect.objectContaining({
        contributions: serviceResponse.contributions,
        isMigrationInProgress: false,
      }),
    );
  });

  it('should return 404 when the user does not exist', async () => {
    // No user inserted in the DB
    const mainHandler = getContributionsHandler(mockCrowi);
    const mockReq = mockDeep<Request>({
      query: { targetUserId: targetUserId.toString() },
    });

    await mainHandler(mockReq, mockRes, () => {});

    expect(mockRes.apiv3Err).toHaveBeenCalledWith('User not found', 404);
    expect(mockRes.apiv3).not.toHaveBeenCalled();
  });

  it('should return isMigrationInProgress=true when the user has not been migrated', async () => {
    await User.create({ _id: targetUserId }); // no contributionsMigratedAt
    const mainHandler = getContributionsHandler(mockCrowi);
    const mockReq = mockDeep<Request>({
      query: { targetUserId: targetUserId.toString() },
    });

    vi.spyOn(ContributionService, 'getContributions').mockResolvedValue({
      contributions: [],
    });

    await mainHandler(mockReq, mockRes, () => {});

    expect(mockRes.apiv3).toHaveBeenCalledWith(
      expect.objectContaining({ isMigrationInProgress: true }),
    );
  });
});
