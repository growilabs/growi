// --- Mock boundary ---------------------------------------------------------
//
// Regression guard for task 2.6 (Testing Strategy item 5): a user whose legacy
// `password` field is unset but who HAS a `passwordHash` must be treated as
// "password is set", so the post-registration auto-login must NOT redirect them
// to `/me#password_settings`.
//
// login.js:145 selects the redirect with `!userData.isPasswordSet()`. Before
// task 2.6 this was `userData.password == null`; for a passwordHash-only user
// (`password === undefined`) that predicate is `true`, wrongly forcing the
// password-settings redirect on every login. This test drives the real
// `actions.register` success path with a passwordHash-only user and asserts the
// observable redirect target, so a revert to `userData.password == null` makes
// it FAIL (the user would be sent to `/me#password_settings`).
//
// The registration success handler (registerSuccessHandler) is a private
// closure reached only through actions.register, so we invoke actions.register
// with the upstream collaborators wired to reach the req.login redirect branch.

import type { Request, Response } from 'express';
import express from 'express';

import type Crowi from '~/server/crowi';

const { getConfig } = vi.hoisted(() => ({ getConfig: vi.fn() }));
vi.mock('~/server/service/config-manager', () => ({
  configManager: { getConfig },
}));
vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));
// Only referenced on the RESTRICTED-mode branch (not exercised here); mock to
// keep the import graph light and side-effect-free.
vi.mock('../service/growi-info', () => ({
  growiInfoService: { getSiteUrl: vi.fn() },
}));
vi.mock('../util/safe-path-utils', () => ({ resolveLocalePath: vi.fn() }));

import { setup } from './login';

const REGISTRATION_MODE_OPEN = 'Open';
const REGISTRATION_MODE_RESTRICTED = 'Restricted';
const REGISTRATION_MODE_CLOSED = 'Closed';

type UserDataStub = {
  password?: string;
  passwordHash?: string;
  isPasswordSet: () => boolean;
  updateLastLoginAt: (date: Date, cb: (err: unknown) => void) => void;
};

/**
 * Build a Crowi whose collaborators drive actions.register straight through to
 * the req.login redirect branch, handing back `userData`.
 */
const buildCrowi = (userData: UserDataStub): Crowi => {
  const crowi = {
    models: {
      User: {
        isRegisterable: (
          _email: string,
          _username: string,
          cb: (isRegisterable: boolean, errOn: Record<string, unknown>) => void,
        ) => cb(true, {}),
        isEmailValid: () => true,
        createUserByEmailAndPassword: (..._args: unknown[]): void => {
          const cb = _args[_args.length - 1] as (
            err: unknown,
            userData: UserDataStub,
          ) => void;
          cb(null, userData);
        },
      },
    },
    aclService: {
      labels: {
        SECURITY_REGISTRATION_MODE_RESTRICTED: REGISTRATION_MODE_RESTRICTED,
        SECURITY_REGISTRATION_MODE_CLOSED: REGISTRATION_MODE_CLOSED,
      },
    },
    mailService: { isMailerSetup: false },
    appService: {},
    activityService: {},
    events: { activity: { emit: vi.fn() } },
  };
  // biome-ignore lint/suspicious/noExplicitAny: hand-wired minimal Crowi for a legacy JS route; no clean partial type exists
  return crowi as any;
};

const buildReqRes = () => {
  const req = {
    user: null,
    form: {
      isValid: true,
      registerForm: {
        name: 'Test User',
        username: 'testuser',
        email: 'test@example.com',
        password: 'plaintext-secret',
      },
    },
    // passport's req.login — immediately invoke the callback (login succeeds).
    login: (_userData: unknown, cb: (err: unknown) => void) => cb(null),
    session: {},
  };
  const apiv3 = vi.fn();
  const apiv3Err = vi.fn();
  const res = {
    apiv3,
    apiv3Err,
    locals: { activity: { _id: 'activity-id' } },
  };
  return { req, res, apiv3, apiv3Err };
};

const runRegister = async (userData: UserDataStub) => {
  getConfig.mockReturnValue(REGISTRATION_MODE_OPEN);
  const crowi = buildCrowi(userData);
  const actions = setup(crowi, express());
  const { req, res, apiv3, apiv3Err } = buildReqRes();

  // biome-ignore lint/suspicious/noExplicitAny: invoking the express handler with mocked req/res
  await actions.register(req as any as Request, res as any as Response);

  return { apiv3, apiv3Err };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('login redirect — passwordHash-only mis-redirect regression (task 2.6)', () => {
  it('does NOT redirect a passwordHash-only user to /me#password_settings', async () => {
    // password unset, passwordHash set → isPasswordSet() true.
    const userData: UserDataStub = {
      password: undefined,
      passwordHash: 'scrypt$stored$hash',
      isPasswordSet: () => true,
      updateLastLoginAt: (_date, cb) => cb(null),
    };

    const { apiv3, apiv3Err } = await runRegister(userData);

    expect(apiv3Err).not.toHaveBeenCalled();
    expect(apiv3).toHaveBeenCalledTimes(1);
    const { redirectTo } = apiv3.mock.calls[0][0];
    expect(redirectTo).not.toBe('/me#password_settings');
    expect(redirectTo).toBe('/');
  });

  it('still redirects a user with no password set to /me#password_settings', async () => {
    // Companion guard: a genuinely password-less user IS sent to set one, so the
    // first test proves the passwordHash-only distinction rather than a constant.
    const userData: UserDataStub = {
      isPasswordSet: () => false,
      updateLastLoginAt: (_date, cb) => cb(null),
    };

    const { apiv3 } = await runRegister(userData);

    expect(apiv3).toHaveBeenCalledTimes(1);
    const { redirectTo } = apiv3.mock.calls[0][0];
    expect(redirectTo).toBe('/me#password_settings');
  });
});
