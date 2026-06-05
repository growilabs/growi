import type { NextFunction, Request, Response } from 'express';

import { SupportedAction } from '~/interfaces/activity';
import Activity from '~/server/models/activity';

import { generateAddActivityMiddleware } from './add-activity';

const buildReq = (overrides: Partial<Request> = {}): Request =>
  ({
    method: 'POST',
    ip: '127.0.0.1',
    originalUrl: '/_api/v3/pages/revert',
    user: { _id: 'user-1', username: 'alice' },
    ...overrides,
  }) as unknown as Request;

const buildRes = (): Response => ({ locals: {} }) as unknown as Response;

describe('generateAddActivityMiddleware', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Why the action must start as ACTION_UNSETTLED (Contribution Graph):
  // A contribution is counted in two places - the one-time migration backfill and
  // the real-time addContribution. They must never count the same event twice.
  // The activity starts UNSETTLED here and only becomes a real action (e.g.
  // PAGE_CREATE) later, after the contribution has been counted. While it is
  // UNSETTLED the migration ignores it, so only addContribution counts it.
  // If this middleware created a real action up front, both would count it -> the
  // count would be 2 instead of 1. This test guards against that change.
  it('persists the activity as ACTION_UNSETTLED', async () => {
    const createdActivity = {
      _id: 'activity-1',
      action: SupportedAction.ACTION_UNSETTLED,
    };
    const createByParametersSpy = vi
      .spyOn(Activity, 'createByParameters')
      .mockResolvedValue(createdActivity as never);

    const req = buildReq();
    const res = buildRes();
    const next = vi.fn();

    await generateAddActivityMiddleware()(req, res, next as NextFunction);

    expect(createByParametersSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: SupportedAction.ACTION_UNSETTLED }),
    );
    expect(res.locals.activity).toBe(createdActivity);
    expect(next).toHaveBeenCalledOnce();
  });

  it('does not create an activity for GET requests', async () => {
    const createByParametersSpy = vi.spyOn(Activity, 'createByParameters');

    const req = buildReq({ method: 'GET' });
    const res = buildRes();
    const next = vi.fn();

    await generateAddActivityMiddleware()(req, res, next as NextFunction);

    expect(createByParametersSpy).not.toHaveBeenCalled();
    expect(res.locals.activity).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });
});
