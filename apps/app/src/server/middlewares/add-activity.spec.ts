import type { IUserHasId } from '@growi/core';
import type { NextFunction, Request, Response } from 'express';
import { mock } from 'vitest-mock-extended';

// Mock the prisma client so createByParameters is a controllable,
// inspectable vi.fn(). The pre-create is removed (design.md: Middleware /
// 事前作成廃止 > add-activity middleware): this middleware must not call it
// at all any more, for GET or non-GET requests.
const mockCreateByParameters = vi.hoisted(() => vi.fn());
vi.mock('~/utils/prisma', () => ({
  prisma: {
    activities: {
      createByParameters: mockCreateByParameters,
    },
  },
}));

// Mock the activity barrel: beginActivity (mint id + stash context) and
// registerFailsafeFinalizer (failure detection + res wiring + cleanup) are
// shared helpers owned by service/activity, not reimplemented in the
// middleware. Their own behavior is covered by begin-activity.spec.ts and
// register-failsafe-finalizer.spec.ts; here we only assert that THIS
// middleware calls them with the right arguments (essential-test-design:
// don't duplicate their tests).
vi.mock('~/server/service/activity/index', () => ({
  beginActivity: vi.fn(),
  registerFailsafeFinalizer: vi.fn(),
}));

import {
  beginActivity,
  registerFailsafeFinalizer,
} from '~/server/service/activity/index';

import { generateAddActivityMiddleware } from './add-activity';

const mockBeginActivity = vi.mocked(beginActivity);
const mockRegisterFailsafeFinalizer = vi.mocked(registerFailsafeFinalizer);

type AuthorizedRequest = Request & { user?: IUserHasId };

/**
 * A minimal ObjectId-like stand-in for req.user._id. `HasObjectId` types
 * `_id` as `string`, but Mongoose hands back a real ObjectId instance at
 * runtime; add-activity.ts applies `.toString()` to normalize it. Using an
 * object here (not already a string) makes that assertion meaningful -- a
 * plain string `_id` would pass even if `.toString()` were missing.
 */
class FakeObjectId {
  private readonly hex: string;

  constructor(hex: string) {
    this.hex = hex;
  }

  toString(): string {
    return this.hex;
  }
}

const USER_ID_HEX = '507f1f77bcf86cd799439011';
const ACTIVITY_ID = '507f1f77bcf86cd799439099';
const ARRIVAL_TIME = new Date('2026-07-09T00:00:00.000Z');

const buildUser = (): IUserHasId =>
  mock<IUserHasId>({
    // WHY: cast localized to this one field (essential-test-patterns Tier 2)
    // -- it simulates the runtime ObjectId shape, which the declared `string`
    // type does not capture.
    _id: new FakeObjectId(USER_ID_HEX) as unknown as string,
    username: 'alice',
  });

const buildReq = (overrides: { method?: string } = {}): AuthorizedRequest =>
  // `ip` is a readonly property on Request, so it must be supplied through
  // the mock's constructor overrides rather than assigned afterwards
  // (`req.ip = ...` would be a TS2540 readonly-assignment error).
  mock<AuthorizedRequest>({
    method: overrides.method ?? 'POST',
    ip: '127.0.0.1',
    originalUrl: '/_api/v3/pages/revert',
    user: buildUser(),
  });

const buildRes = (): Response => {
  const res = mock<Response>();
  res.locals = {};
  return res;
};

describe('generateAddActivityMiddleware', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(ARRIVAL_TIME);
    vi.clearAllMocks();
    mockBeginActivity.mockReturnValue({ activityId: ACTIVITY_ID });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('for a non-GET request', () => {
    it('does not write to the DB (the pre-create is removed)', async () => {
      const req = buildReq();
      const res = buildRes();
      const next = vi.fn();

      // `await` tolerates both a sync `void` return and a Promise<void>
      // return, so this assertion holds regardless of the middleware's
      // sync/async signature.
      await generateAddActivityMiddleware()(req, res, next as NextFunction);

      expect(mockCreateByParameters).not.toHaveBeenCalled();
    });

    it('mints an id and stashes the request context via beginActivity, with createdAt at arrival time', async () => {
      const req = buildReq();
      const res = buildRes();
      const next = vi.fn();

      await generateAddActivityMiddleware()(req, res, next as NextFunction);

      expect(mockBeginActivity).toHaveBeenCalledTimes(1);
      expect(mockBeginActivity).toHaveBeenCalledWith({
        ip: '127.0.0.1',
        endpoint: '/_api/v3/pages/revert',
        userId: USER_ID_HEX,
        username: 'alice',
        createdAt: ARRIVAL_TIME,
      });
    });

    it('exposes the minted id at res.locals.activity._id (preserves the 37 emit(...).activity._id call sites)', async () => {
      const req = buildReq();
      const res = buildRes();
      const next = vi.fn();

      await generateAddActivityMiddleware()(req, res, next as NextFunction);

      expect(res.locals.activity).toEqual({ _id: ACTIVITY_ID });
    });

    it('registers the failsafe finalizer with the response, the minted id, and the exact context passed to beginActivity', async () => {
      const req = buildReq();
      const res = buildRes();
      const next = vi.fn();

      await generateAddActivityMiddleware()(req, res, next as NextFunction);

      expect(mockRegisterFailsafeFinalizer).toHaveBeenCalledTimes(1);
      const [beginActivityContext] = mockBeginActivity.mock.calls[0];
      expect(mockRegisterFailsafeFinalizer).toHaveBeenCalledWith(
        res,
        ACTIVITY_ID,
        beginActivityContext,
      );
      // Same object, not a second, independently-built context -- otherwise
      // the fail-safe row and the settled row could disagree (e.g. a second
      // `new Date()` call drifting from the first).
      const [, , finalizerContext] =
        mockRegisterFailsafeFinalizer.mock.calls[0];
      expect(finalizerContext).toBe(beginActivityContext);
    });

    it('is best-effort: a beginActivity failure is swallowed and next() still runs', async () => {
      mockBeginActivity.mockImplementation(() => {
        throw new Error('boom');
      });
      const req = buildReq();
      const res = buildRes();
      const next = vi.fn();

      // Propagates naturally if the middleware stops swallowing the error --
      // no need for an explicit try/catch wrapper in the test.
      await generateAddActivityMiddleware()(req, res, next as NextFunction);

      expect(mockRegisterFailsafeFinalizer).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });

    it('calls next() exactly once', async () => {
      const req = buildReq();
      const res = buildRes();
      const next = vi.fn();

      await generateAddActivityMiddleware()(req, res, next as NextFunction);

      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe('for a GET request', () => {
    it('does nothing (unchanged early return): no DB write, no mint, no finalizer registration', async () => {
      const req = buildReq({ method: 'GET' });
      const res = buildRes();
      const next = vi.fn();

      await generateAddActivityMiddleware()(req, res, next as NextFunction);

      expect(mockCreateByParameters).not.toHaveBeenCalled();
      expect(mockBeginActivity).not.toHaveBeenCalled();
      expect(mockRegisterFailsafeFinalizer).not.toHaveBeenCalled();
      expect(res.locals.activity).toBeUndefined();
      expect(next).toHaveBeenCalledOnce();
    });
  });
});
