import { ErrorV3 } from '@growi/core/dist/models';
import type { NextFunction, Response } from 'express';
import type { Request } from 'express-validator/src/base';

import { excludeReadOnlyUser } from './exclude-read-only-user';

describe('excludeReadOnlyUser', () => {
  let req: Request;
  let res: Response & { apiv3Err: ReturnType<typeof vi.fn> };
  let next: NextFunction;

  beforeEach(() => {
    req = {
      user: {},
    } as unknown as Request;
    res = {
      apiv3Err: vi.fn(),
    } as unknown as Response & { apiv3Err: ReturnType<typeof vi.fn> };
    next = vi.fn() as unknown as NextFunction;
  });

  test('should call next if user is not found', () => {
    req.user = null;

    excludeReadOnlyUser(req, res, next);

    expect(next).toBeCalled();
    expect(res.apiv3Err).not.toBeCalled();
  });

  test('should call next if user is not read only', () => {
    req.user.readOnly = false;

    excludeReadOnlyUser(req, res, next);

    expect(next).toBeCalled();
    expect(res.apiv3Err).not.toBeCalled();
  });

  test('should return error response if user is read only', () => {
    req.user.readOnly = true;

    excludeReadOnlyUser(req, res, next);

    expect(next).not.toBeCalled();
    expect(res.apiv3Err).toBeCalledWith(
      new ErrorV3('This user is read only user', 'validatioin_failed'),
    );
  });
});
