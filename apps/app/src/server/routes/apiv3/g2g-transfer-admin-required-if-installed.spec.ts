import type { NextFunction, Request, Response } from 'express';

import { generateAdminRequiredIfInstalled } from './g2g-transfer-admin-required-if-installed';

describe('generateAdminRequiredIfInstalled', () => {
  let req: Request;
  let res: Response;
  let next: NextFunction;

  beforeEach(() => {
    req = {} as unknown as Request;
    res = {} as unknown as Response;
    next = vi.fn() as unknown as NextFunction;
  });

  test('should call next() and skip adminRequired when the app is not installed', () => {
    const isInstalled = vi.fn<() => boolean>().mockReturnValue(false);
    const adminRequired = vi.fn();

    const middleware = generateAdminRequiredIfInstalled(
      isInstalled,
      adminRequired,
    );
    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(adminRequired).not.toHaveBeenCalled();
  });

  test('should delegate to adminRequired when the app is installed', () => {
    const isInstalled = vi.fn<() => boolean>().mockReturnValue(true);
    const adminRequired = vi.fn();

    const middleware = generateAdminRequiredIfInstalled(
      isInstalled,
      adminRequired,
    );
    middleware(req, res, next);

    expect(adminRequired).toHaveBeenCalledTimes(1);
    expect(adminRequired).toHaveBeenCalledWith(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  // Regression guard for the g2g-transfer auth bypass (#10151 vulnerability report):
  // the install state must be read live on every request, NOT captured when the
  // middleware factory runs at server boot. An instance that finished installation
  // but has not been restarted must become protected immediately.
  test('should read the install state live on each request, not capture it at factory-creation time', () => {
    const isInstalled = vi.fn<() => boolean>();
    const adminRequired = vi.fn();

    const middleware = generateAdminRequiredIfInstalled(
      isInstalled,
      adminRequired,
    );

    // Before installation completes: unauthenticated access is allowed.
    isInstalled.mockReturnValue(false);
    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(adminRequired).not.toHaveBeenCalled();

    // Installation just completed in the same process (no restart yet).
    isInstalled.mockReturnValue(true);
    middleware(req, res, next);
    expect(adminRequired).toHaveBeenCalledTimes(1);
    // next() must not have been called an additional time by the middleware itself.
    expect(next).toHaveBeenCalledTimes(1);
  });
});
