import type { Request } from 'express';
import { mockClear, mockDeep } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import { ContributionCacheManager } from '../services/cache-manager';
import { getContributionsHandlerFactory } from './get-contributions';

describe('getContributionsHandler (Unit Test)', () => {
  const mockCrowi = mockDeep<Crowi>();

  const apiv3Mock = vi.fn().mockReturnThis();
  const apiv3ErrMock = vi.fn().mockReturnThis();

  const mockRes = {
    apiv3: apiv3Mock,
    apiv3Err: apiv3ErrMock,
  } as unknown as ApiV3Response;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockClear(apiv3Mock);
  });

  it('should return 200 and fallback graph when service fails', async () => {
    // ARRANGE
    const handlers = getContributionsHandlerFactory(mockCrowi);
    const mainHandler = handlers[handlers.length - 1];

    const mockReq = {
      query: { targetUserId: '694108d387012da1446b4a0e' },
    } as Partial<Request> as Request;

    const cacheSpy = vi
      .spyOn(ContributionCacheManager.prototype, 'getUpdatedCache')
      .mockRejectedValue(new Error('DB failure'));

    // ACT
    await mainHandler(mockReq, mockRes, () => {});

    expect(apiv3Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        isTemporaryUnavailable: true,
      }),
    );

    // Verify the data integrity of the fallback (The "What", not the "How")
    const responseData = apiv3Mock.mock.calls[0][0];
    expect(responseData.contributions).toHaveLength(365);
    expect(responseData.contributions[0].count).toBe(0);

    cacheSpy.mockRestore();
  });
});
