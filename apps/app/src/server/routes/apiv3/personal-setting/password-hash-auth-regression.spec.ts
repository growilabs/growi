// --- Mock boundary ---------------------------------------------------------
//
// These tests exercise two ROUTE HANDLERS built by personal-setting's setup()
// factory, invoking each handler's final layer directly (the same handler-off-
// the-router-stack technique as user-ui-settings.spec / get-models.spec). The
// preceding auth/validator middlewares are not part of the contract under test.
//
// What they guard (regression, task 2.8):
//  - PUT /password (task 2.5): the old-password check must actually reject a
//    wrong / missing oldPassword. isPasswordValid() is async and returns a
//    VerifyResult ({ isValid }); the guard reads `!(await ...).isValid`. If the
//    code ever reverted to the un-awaited `!user.isPasswordValid(oldPassword)`
//    form, `!Promise` is always false, the wrong-password branch is skipped, and
//    any password would be accepted (auth bypass). A mocked isPasswordValid that
//    resolves `{ isValid: false }` makes these tests FAIL against that buggy form.
//  - PUT /disassociate-ldap (task 2.6): a passwordHash-only user (password unset,
//    passwordHash set) must be treated as "password is set" via isPasswordSet(),
//    so LDAP disassociation is NOT wrongly blocked. If the check reverted to
//    `user.password == null`, a passwordHash-only user (password === undefined)
//    would be blocked — these tests assert it is allowed through.
//
// We only mock the module boundaries the handlers reach:
//   - '~/utils/prisma': the disassociate handler counts/deletes externalaccounts.
import type { NextFunction, Request, RequestHandler } from 'express';
import { mockDeep } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    externalaccounts: {
      count: vi.fn(),
      delete: vi.fn(),
    },
  },
}));
vi.mock('~/utils/prisma', () => ({ prisma: prismaMock }));

vi.mock('~/utils/logger', () => ({
  default: () => ({
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { setup } from './index';

// ---------------------------------------------------------------------------
// Handler extraction: read the final layer of the PUT <path> route off the
// router the factory builds.
// ---------------------------------------------------------------------------
const getHandler = (path: string): RequestHandler => {
  const crowi = mockDeep<Crowi>();
  const router = setup(crowi);
  const layer = router.stack.find(
    // biome-ignore lint/suspicious/noExplicitAny: Express Layer internals are untyped
    (l: any) => l.route?.path === path && l.route?.methods?.put,
  );
  if (layer == null) {
    throw new Error(`route PUT ${path} not found`);
  }
  // biome-ignore lint/suspicious/noExplicitAny: Express Layer internals are untyped
  const stack = (layer as any).route.stack;
  return stack[stack.length - 1].handle;
};

// A minimal User document stub exposing only the methods the handlers call.
type UserStub = {
  _id: { toString: () => string };
  id: string;
  isPasswordSet: () => boolean;
  isPasswordValid?: (password?: string) => Promise<{ isValid: boolean }>;
  updatePassword?: (password: string) => Promise<unknown>;
};

const buildRes = () => {
  const apiv3 = vi.fn();
  const apiv3Err = vi.fn();
  const res = {
    apiv3,
    apiv3Err,
    locals: { activity: { _id: 'activity-id' } },
  };
  return { res, apiv3, apiv3Err };
};

const invoke = async (
  handler: RequestHandler,
  req: unknown,
  res: unknown,
): Promise<void> => {
  // biome-ignore lint/suspicious/noExplicitAny: invoking the express handler with mocked req/res
  await handler(req as any, res as any, vi.fn() as NextFunction);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PUT /password — old-password check regression (task 2.5)', () => {
  const passwordChangeHandler = () => getHandler('/password');

  const buildUser = (
    isValid: boolean,
  ): UserStub & {
    isPasswordValid: ReturnType<typeof vi.fn>;
    updatePassword: ReturnType<typeof vi.fn>;
  } => ({
    _id: { toString: () => 'uid' },
    id: 'uid',
    isPasswordSet: () => true,
    // Returns a Promise resolving to a VerifyResult — the shape the real
    // async isPasswordValid returns. The handler MUST await it and read
    // `.isValid`; a non-awaited `!Promise` would always be falsy.
    isPasswordValid: vi.fn(async () => ({ isValid })),
    updatePassword: vi.fn(async () => ({ _id: 'uid' })),
  });

  it('rejects a WRONG oldPassword and does NOT update the password', async () => {
    const user = buildUser(false);
    const req = {
      user,
      body: { oldPassword: 'wrong', newPassword: 'new-secret' },
    } as unknown as Request;
    const { res, apiv3, apiv3Err } = buildRes();

    await invoke(passwordChangeHandler(), req, res);

    expect(apiv3Err).toHaveBeenCalledWith('wrong-current-password', 400);
    expect(user.updatePassword).not.toHaveBeenCalled();
    expect(apiv3).not.toHaveBeenCalled();
  });

  it('rejects a MISSING oldPassword and does NOT update the password', async () => {
    // isPasswordValid(undefined) resolves { isValid: false } — a missing
    // oldPassword cannot verify against a set password.
    const user = buildUser(false);
    const req = {
      user,
      body: { newPassword: 'new-secret' },
    } as unknown as Request;
    const { res, apiv3, apiv3Err } = buildRes();

    await invoke(passwordChangeHandler(), req, res);

    expect(apiv3Err).toHaveBeenCalledWith('wrong-current-password', 400);
    expect(user.updatePassword).not.toHaveBeenCalled();
    expect(apiv3).not.toHaveBeenCalled();
  });

  it('accepts a CORRECT oldPassword and updates the password', async () => {
    const user = buildUser(true);
    const req = {
      user,
      body: { oldPassword: 'correct', newPassword: 'new-secret' },
    } as unknown as Request;
    const { res, apiv3, apiv3Err } = buildRes();

    await invoke(passwordChangeHandler(), req, res);

    expect(user.updatePassword).toHaveBeenCalledWith('new-secret');
    expect(apiv3).toHaveBeenCalledTimes(1);
    expect(apiv3Err).not.toHaveBeenCalled();
  });

  it('skips the old-password check when no password is set (isPasswordSet() false)', async () => {
    // A user with no password set must be able to set one without an
    // oldPassword — the `isPasswordSet() &&` short-circuit guarantees this.
    const user = {
      _id: { toString: () => 'uid' },
      id: 'uid',
      isPasswordSet: () => false,
      isPasswordValid: vi.fn(async () => ({ isValid: false })),
      updatePassword: vi.fn(async () => ({ _id: 'uid' })),
    };
    const req = {
      user,
      body: { newPassword: 'new-secret' },
    } as unknown as Request;
    const { res, apiv3, apiv3Err } = buildRes();

    await invoke(passwordChangeHandler(), req, res);

    expect(user.isPasswordValid).not.toHaveBeenCalled();
    expect(user.updatePassword).toHaveBeenCalledWith('new-secret');
    expect(apiv3).toHaveBeenCalledTimes(1);
    expect(apiv3Err).not.toHaveBeenCalled();
  });
});

describe('PUT /disassociate-ldap — passwordHash-only mis-block regression (task 2.6)', () => {
  const disassociateHandler = () => getHandler('/disassociate-ldap');

  const buildReq = (isPasswordSet: boolean): Request => {
    const user: UserStub = {
      _id: { toString: () => 'uid' },
      id: 'uid',
      // password field is intentionally absent (passwordHash-only shape). A
      // regression to `user.password == null` would read undefined == null.
      isPasswordSet: () => isPasswordSet,
    };
    return {
      user,
      body: { providerType: 'ldap', accountId: 'acc-1' },
    } as unknown as Request;
  };

  it('does NOT block a passwordHash-only user with a single external account', async () => {
    // count <= 1 AND password "set" (via isPasswordSet) → must proceed.
    prismaMock.externalaccounts.count.mockResolvedValue(1);
    prismaMock.externalaccounts.delete.mockResolvedValue({ _id: 'ea-1' });
    const req = buildReq(true);
    const { res, apiv3, apiv3Err } = buildRes();

    await invoke(disassociateHandler(), req, res);

    expect(apiv3Err).not.toHaveBeenCalledWith(
      'disassociate-ldap-account-failed',
    );
    expect(prismaMock.externalaccounts.delete).toHaveBeenCalledTimes(1);
    expect(apiv3).toHaveBeenCalledTimes(1);
  });

  it('still blocks a user with no password and a single external account', async () => {
    // Companion guard: isPasswordSet() false AND count <= 1 → genuinely unsafe,
    // so disassociation is refused and nothing is deleted.
    prismaMock.externalaccounts.count.mockResolvedValue(1);
    const req = buildReq(false);
    const { res, apiv3, apiv3Err } = buildRes();

    await invoke(disassociateHandler(), req, res);

    expect(apiv3Err).toHaveBeenCalledWith('disassociate-ldap-account-failed');
    expect(prismaMock.externalaccounts.delete).not.toHaveBeenCalled();
    expect(apiv3).not.toHaveBeenCalled();
  });
});

describe('credential-leak prevention in userData responses (review #2)', () => {
  // A raw user doc as the update methods return it (this.save() → full document,
  // credential fields included). The schema only configures a `toObject`
  // transform, NOT `toJSON`, so passing this straight to res.apiv3 → res.json
  // would serialize the credentials via toJSON untouched. Each route must run it
  // through serializeUserSecurely first. A plain object exercises the same
  // omit-insecure-attributes contract (isEmailPublished false → email omitted).
  const rawUserDoc = () => ({
    _id: { toString: () => 'uid' },
    id: 'uid',
    name: 'Test User',
    username: 'test-user',
    isGravatarEnabled: true,
    isEmailPublished: false,
    password: 'legacy-sha256',
    passwordHash: 'scrypt$hash',
    apiToken: 'secret-token',
    email: 'test@example.com',
  });

  const expectNoCredentials = (userData: unknown) => {
    expect(userData).not.toHaveProperty('passwordHash');
    expect(userData).not.toHaveProperty('password');
    expect(userData).not.toHaveProperty('apiToken');
    // email is omitted unless isEmailPublished (false here).
    expect(userData).not.toHaveProperty('email');
  };

  it('PUT /password does not return passwordHash/password/apiToken/email', async () => {
    const user = {
      _id: { toString: () => 'uid' },
      id: 'uid',
      isPasswordSet: () => false, // skip the old-password check
      updatePassword: vi.fn(async () => rawUserDoc()),
    };
    const req = {
      user,
      body: { newPassword: 'new-secret' },
    } as unknown as Request;
    const { res, apiv3, apiv3Err } = buildRes();

    await invoke(getHandler('/password'), req, res);

    expect(apiv3Err).not.toHaveBeenCalled();
    expect(apiv3).toHaveBeenCalledTimes(1);
    expectNoCredentials(apiv3.mock.calls[0][0].userData);
  });

  it('PUT /api-token does not return apiToken/passwordHash/password/email', async () => {
    const user = { updateApiToken: vi.fn(async () => rawUserDoc()) };
    const req = { user } as unknown as Request;
    const { res, apiv3, apiv3Err } = buildRes();

    await invoke(getHandler('/api-token'), req, res);

    expect(apiv3Err).not.toHaveBeenCalled();
    expect(apiv3).toHaveBeenCalledTimes(1);
    expectNoCredentials(apiv3.mock.calls[0][0].userData);
  });

  it('PUT /image-type strips credentials but keeps isGravatarEnabled', async () => {
    const user = {
      updateIsGravatarEnabled: vi.fn(async () => rawUserDoc()),
    };
    const req = {
      user,
      body: { isGravatarEnabled: true },
    } as unknown as Request;
    const { res, apiv3, apiv3Err } = buildRes();

    await invoke(getHandler('/image-type'), req, res);

    expect(apiv3Err).not.toHaveBeenCalled();
    expect(apiv3).toHaveBeenCalledTimes(1);
    const { userData } = apiv3.mock.calls[0][0];
    expectNoCredentials(userData);
    // a non-credential field the client depends on must survive serialization.
    expect(userData.isGravatarEnabled).toBe(true);
  });
});
