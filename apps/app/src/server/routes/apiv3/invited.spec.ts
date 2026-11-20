import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import { UserStatus } from '~/server/models/user/conts';

import { setup } from './invited';
import addCustomFunctionToResponse from './response';

const mocks = vi.hoisted(() => ({
  isUserCountExceedsUpperLimit: vi.fn(),
  isRegisterableUsername: vi.fn(),
}));

vi.mock('~/server/middlewares/application-installed', () => ({
  setup: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('mongoose', async (importOriginal) => {
  const original = await importOriginal<typeof import('mongoose')>();
  return {
    ...original,
    default: {
      ...original.default,
      model: () => ({
        isUserCountExceedsUpperLimit: mocks.isUserCountExceedsUpperLimit,
        isRegisterableUsername: mocks.isRegisterableUsername,
      }),
    },
  };
});

type SessionUser = {
  status: UserStatus;
  activateInvitedUser: ReturnType<typeof vi.fn>;
};

const VALID_FORM = {
  invitedForm: { username: 'newname', name: 'New Name', password: 'secret123' },
};

addCustomFunctionToResponse(express);
const router = setup(mock<Crowi>());

const buildApp = (user?: SessionUser) => {
  const app = express();
  app.use(express.json());
  app.use((req: Request & { user?: SessionUser }, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/invited', router);
  return app;
};

const sessionUserWithStatus = (status: UserStatus): SessionUser => ({
  status,
  activateInvitedUser: vi.fn().mockResolvedValue(undefined),
});

describe('POST /invited', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isUserCountExceedsUpperLimit.mockResolvedValue(false);
    mocks.isRegisterableUsername.mockResolvedValue(true);
  });

  it('activates an INVITED user with the submitted form', async () => {
    const user = sessionUserWithStatus(UserStatus.STATUS_INVITED);

    const res = await request(buildApp(user)).post('/invited').send(VALID_FORM);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ redirectTo: '/' });
    expect(user.activateInvitedUser).toHaveBeenCalledWith(
      'newname',
      'New Name',
      'secret123',
    );
  });

  it.each([
    ['REGISTERED', UserStatus.STATUS_REGISTERED],
    ['ACTIVE', UserStatus.STATUS_ACTIVE],
    ['SUSPENDED', UserStatus.STATUS_SUSPENDED],
    ['DELETED', UserStatus.STATUS_DELETED],
  ])('rejects a %s user with 403 without activating', async (_, status) => {
    const user = sessionUserWithStatus(status);

    const res = await request(buildApp(user)).post('/invited').send(VALID_FORM);

    expect(res.status).toBe(403);
    expect(user.activateInvitedUser).not.toHaveBeenCalled();
    expect(mocks.isRegisterableUsername).not.toHaveBeenCalled();
  });

  it('redirects to /login when there is no session user', async () => {
    const res = await request(buildApp(undefined))
      .post('/invited')
      .send(VALID_FORM);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ redirectTo: '/login' });
  });
});
