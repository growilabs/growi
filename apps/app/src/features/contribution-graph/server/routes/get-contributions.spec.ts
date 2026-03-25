import type { Request } from 'express';

import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';

import { ContributionCacheManager } from '../services/cache-manager';
import { getContributionsHandlerFactory } from './get-contributions';

describe('getContributionsHandler (Unit Test)', () => {
  it('should return 200 and fallback graph when service fails', async () => {
    // Setup the factory with a mocked Crowi instance
    const mockCrowi = {} as Crowi;
    const handlers = getContributionsHandlerFactory(mockCrowi);

    // The handler we want is the last one in the middleware chain
    const mainHandler = handlers[handlers.length - 1];

    // Mock Request and Response
    const req = {
      query: { targetUserId: '694108d387012da1446b4a0e' },
    } as unknown as Request;

    const res = {
      apiv3: vi.fn().mockReturnThis(),
      apiv3Err: vi.fn().mockReturnThis(),
    } as unknown as ApiV3Response;

    // Mock the service failure
    const spy = vi
      .spyOn(ContributionCacheManager.prototype, 'getUpdatedCache')
      .mockRejectedValue(new Error('DB failure'));

    // RequestHandler can be a Promise or void, so we await it
    await mainHandler(req, res, () => {});

    expect(res.apiv3).toHaveBeenCalledWith(
      expect.objectContaining({
        isTemporaryUnavailable: true,
      }),
    );

    const callArgs = (res.apiv3 as any).mock.calls[0][0];
    expect(callArgs.contributions).toHaveLength(365);
    expect(callArgs.contributions[0].count).toBe(0);

    spy.mockRestore();
  });
});
