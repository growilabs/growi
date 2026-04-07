import type { Request } from 'express';
import { mockClear, mockDeep } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import { ContributionCacheManager } from '../services/cache-manager';
import { getContributionsHandlerFactory } from './get-contributions';

describe('getContributionsHandler (Unit Test)', () => {
  const mockCrowi = mockDeep<Crowi>();
  const mockRes = mockDeep<ApiV3Response>();

  beforeEach(() => {
    vi.restoreAllMocks();
    mockClear(mockRes);
  });

  it('should return 200 and fallback graph when service fails', async () => {
    const handlers = getContributionsHandlerFactory(mockCrowi);
    const mainHandler = handlers[handlers.length - 1];

    const mockReq = mockDeep<Request>({
      query: { targetUserId: '694108d387012da1446b4a0e' },
    });

    const cacheSpy = vi
      .spyOn(ContributionCacheManager.prototype, 'getUpdatedCache')
      .mockRejectedValue(new Error('DB failure'));

    await mainHandler(mockReq, mockRes, () => {});

    expect(mockRes.apiv3).toHaveBeenCalledWith(
      expect.objectContaining({
        isTemporaryUnavailable: true,
      }),
    );

    const responseData = mockRes.apiv3.mock.calls[0][0];
    expect(responseData.contributions).toHaveLength(365);
    expect(responseData.contributions[0].count).toBe(0);

    cacheSpy.mockRestore();
  });
});
