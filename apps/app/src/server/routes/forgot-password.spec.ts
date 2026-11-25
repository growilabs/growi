import express from 'express';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import { forgotPasswordErrorCode } from '~/interfaces/errors/forgot-password';
import type Crowi from '~/server/crowi';
import addCustomFunctionToResponse from '~/server/routes/apiv3/response';

import { checkForgotPasswordEnabledMiddlewareFactory } from './forgot-password';

vi.mock('~/utils/logger', () => ({ default: () => ({ error: vi.fn() }) }));

const crowiWithPasswordReset = (isEnabled: boolean): Crowi => {
  const configManager = mock<Crowi['configManager']>();
  configManager.getConfig
    .calledWith('security:passport-local:isPasswordResetEnabled')
    .mockReturnValue(isEnabled);
  const passportService = mock<Crowi['passportService']>({
    isLocalStrategySetup: true,
  });
  return mock<Crowi>({ configManager, passportService });
};

addCustomFunctionToResponse(express);

const appFor = (crowi: Crowi, forApi: boolean) => {
  const app = express();
  app.use(checkForgotPasswordEnabledMiddlewareFactory(crowi, forApi));
  app.post('/', (_req, res) => {
    res.sendStatus(200);
  });
  return app;
};

describe('checkForgotPasswordEnabledMiddlewareFactory', () => {
  it('answers an API request with a 405 carrying the unavailable error code when password reset is disabled', async () => {
    const res = await request(appFor(crowiWithPasswordReset(false), true)).post(
      '/',
    );

    expect(res.status).toBe(405);
    expect(res.body.errors).toEqual([
      expect.objectContaining({
        code: forgotPasswordErrorCode.PASSWORD_RESET_IS_UNAVAILABLE,
      }),
    ]);
  });

  it('lets an API request through when password reset is enabled', async () => {
    const res = await request(appFor(crowiWithPasswordReset(true), true)).post(
      '/',
    );

    expect(res.status).toBe(200);
  });

  it('answers a page request with a 404 when password reset is disabled', async () => {
    const res = await request(
      appFor(crowiWithPasswordReset(false), false),
    ).post('/');

    expect(res.status).toBe(404);
  });
});
