import type { Request } from 'express';
import { mockClear, mockDeep } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import * as ContributionService from '../services/contribution-service';
import { getContributionsHandler } from './get-contributions';

describe('getContributionsHandler', () => {
  const mockCrowi = mockDeep<Crowi>();
  const mockRes = mockDeep<ApiV3Response>();

  beforeEach(() => {
    vi.restoreAllMocks();
    mockClear(mockRes);
  });

  it('should return 200 and fallback graph when service fails', async () => {
    const mainHandler = getContributionsHandler(mockCrowi);
    const mockReq = mockDeep<Request>({
      query: { targetUserId: '694108d387012da1446b4a0e' },
    });

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

  it('should pass the service response directly to res.apiv3', async () => {
    const mainHandler = getContributionsHandler(mockCrowi);
    const mockReq = mockDeep<Request>({
      query: { targetUserId: '694108d387012da1446b4a0e' },
    });

    const serviceResponse = {
      contributions: [{ date: '2026-04-20', count: 5 }],
    };

    vi.spyOn(ContributionService, 'getContributions').mockResolvedValue(
      serviceResponse,
    );

    await mainHandler(mockReq, mockRes, () => {});

    expect(mockRes.apiv3).toHaveBeenCalledWith(serviceResponse);
  });

  it('should return an empty array when the user has no contributions', async () => {
    const mainHandler = getContributionsHandler(mockCrowi);
    const mockReq = mockDeep<Request>({
      query: { targetUserId: '694108d387012da1446b4a0e' },
    });

    vi.spyOn(ContributionService, 'getContributions').mockResolvedValue({
      contributions: [],
    });

    await mainHandler(mockReq, mockRes, () => {});

    expect(mockRes.apiv3).toHaveBeenCalledWith({ contributions: [] });
  });
});
