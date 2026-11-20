import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import type { Model } from 'mongoose';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import { forgotPasswordErrorCode } from '~/interfaces/errors/forgot-password';
import type Crowi from '~/server/crowi';
import type { ApiV3Response } from '~/server/routes/apiv3/interfaces/apiv3-response';
import { configManager } from '~/server/service/config-manager';
import { growiInfoService } from '~/server/service/growi-info';
import type { S2sMessagingService } from '~/server/service/s2s-messaging/base';

const RESPONSE_DELAY_MS = 18_000;

const passthroughMiddleware = (
  _req: Request,
  _res: Response,
  next: NextFunction,
) => next();

vi.mock('../forgot-password', () => ({
  checkForgotPasswordEnabledMiddlewareFactory: () => passthroughMiddleware,
}));

// Simulates add-activity failing to create the activity: it only logs the
// error and moves on, leaving res.locals.activity undefined.
vi.mock('~/server/middlewares/add-activity', () => ({
  generateAddActivityMiddleware: () => passthroughMiddleware,
}));

vi.mock('~/server/service/growi-info', () => ({
  growiInfoService: { getSiteUrl: vi.fn(() => 'http://localhost:3000') },
}));

describe('POST /forgot-password when the activity could not be created', () => {
  let app: express.Application;
  const findOne = vi.fn();

  beforeEach(async () => {
    configManager.setS2sMessagingService(mock<S2sMessagingService>());
    await configManager.loadConfigs();

    const crowiMock = mock<Crowi>({
      models: {
        // WHY: mongoose's Model type has too many overloads to be partially
        // mocked type-safely; the route only calls User.findOne.
        User: { findOne } as unknown as Model<unknown>,
      },
      events: { activity: { emit: vi.fn() } },
    });

    app = express();
    app.use(express.json());
    app.use((_req, res, next) => {
      const apiRes = res as ApiV3Response;
      apiRes.apiv3 = (data) => res.json(data ?? {});
      apiRes.apiv3Err = (error, statusCode = 500) =>
        res.status(statusCode).json({ error });
      next();
    });

    const { setup } = await import('./forgot-password');
    app.use('/', setup(crowiMock));

    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ['setTimeout', 'clearTimeout', 'Date'],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  /**
   * Send a request and report the response only once it arrives, so a test
   * can assert that nothing is returned before the fixed response time.
   */
  const send = async (email: string) => {
    const state: { response?: request.Response } = {};
    const promise = request(app)
      .post('/')
      .send({ email })
      .then((response) => {
        state.response = response;
        return response;
      });
    // wait until the handler has started (it reads the site URL first)
    await vi.waitFor(() =>
      expect(growiInfoService.getSiteUrl).toHaveBeenCalled(),
    );
    return { state, promise };
  };

  it('answers an unknown email with 200 at the fixed response time instead of hanging', async () => {
    findOne.mockResolvedValue(null);
    const { state, promise } = await send('nobody@example.com');

    await vi.advanceTimersByTimeAsync(RESPONSE_DELAY_MS - 1000);
    expect(state.response).toBeUndefined();

    await vi.advanceTimersByTimeAsync(2000);
    const response = await promise;
    expect(response.status).toBe(200);
  });

  it('answers a failed account lookup with the failure code at the fixed response time', async () => {
    findOne.mockRejectedValue(new Error('db down'));
    const { state, promise } = await send('user@example.com');

    await vi.advanceTimersByTimeAsync(RESPONSE_DELAY_MS - 1000);
    expect(state.response).toBeUndefined();

    await vi.advanceTimersByTimeAsync(2000);
    const response = await promise;
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe(
      forgotPasswordErrorCode.PASSWORD_RESET_REQUEST_FAILED,
    );
  });

  it('answers an unexpected error in the handler with the failure code at the fixed response time', async () => {
    vi.mocked(growiInfoService.getSiteUrl).mockImplementationOnce(() => {
      throw new Error('site url is not configured');
    });
    const { state, promise } = await send('user@example.com');

    await vi.advanceTimersByTimeAsync(RESPONSE_DELAY_MS - 1000);
    expect(state.response).toBeUndefined();

    await vi.advanceTimersByTimeAsync(2000);
    const response = await promise;
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe(
      forgotPasswordErrorCode.PASSWORD_RESET_REQUEST_FAILED,
    );
  });
});
