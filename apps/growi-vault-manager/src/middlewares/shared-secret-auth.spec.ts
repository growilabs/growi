import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SharedSecretAuth } from './shared-secret-auth.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(authHeader?: string): Request {
  return {
    headers: authHeader != null ? { authorization: authHeader } : {},
  } as unknown as Request;
}

function makeRes() {
  const json = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnValue({ json });
  // Capture the chained call: res.status(x).json(y)
  const res = { status, json } as unknown as Response;
  return { res, status, json };
}

function makeNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SharedSecretAuth', () => {
  const VALID_SECRET = 'super-secret-token-for-testing';

  beforeEach(() => {
    process.env.VAULT_MANAGER_INTERNAL_SECRET = VALID_SECRET;
  });

  describe('when a correct Bearer token is provided', () => {
    it('calls next() and does not return 401', () => {
      const middleware = new SharedSecretAuth();
      const req = makeReq(`Bearer ${VALID_SECRET}`);
      const { res, status } = makeRes();
      const next = makeNext();

      middleware.use(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(status).not.toHaveBeenCalled();
    });
  });

  describe('when an incorrect Bearer token is provided', () => {
    it('returns 401 Unauthorized', () => {
      const middleware = new SharedSecretAuth();
      const req = makeReq('Bearer wrong-token-same-length!!');
      const { res, status, json } = makeRes();
      const next = makeNext();

      middleware.use(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(401);
      expect(json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    it('returns 401 when token length differs from secret', () => {
      const middleware = new SharedSecretAuth();
      const req = makeReq('Bearer short');
      const { res, status } = makeRes();
      const next = makeNext();

      middleware.use(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(401);
    });
  });

  describe('when the Authorization header is absent', () => {
    it('returns 401 Unauthorized', () => {
      const middleware = new SharedSecretAuth();
      const req = makeReq(); // no header
      const { res, status, json } = makeRes();
      const next = makeNext();

      middleware.use(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(401);
      expect(json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    });

    it('returns 401 when Authorization header has wrong scheme', () => {
      const middleware = new SharedSecretAuth();
      const req = makeReq(`Basic ${VALID_SECRET}`);
      const { res, status } = makeRes();
      const next = makeNext();

      middleware.use(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(401);
    });
  });

  describe('constant-time comparison', () => {
    it('uses crypto.timingSafeEqual for token validation', () => {
      // Spy on crypto.timingSafeEqual to verify it is invoked
      const timingSafeEqualSpy = vi.spyOn(crypto, 'timingSafeEqual');

      const middleware = new SharedSecretAuth();
      const req = makeReq(`Bearer ${VALID_SECRET}`);
      const { res } = makeRes();
      const next = makeNext();

      middleware.use(req, res, next);

      expect(timingSafeEqualSpy).toHaveBeenCalledOnce();

      timingSafeEqualSpy.mockRestore();
    });

    it('does not invoke timingSafeEqual when header is absent (avoids TypeError on mismatched buffer lengths)', () => {
      const timingSafeEqualSpy = vi.spyOn(crypto, 'timingSafeEqual');

      const middleware = new SharedSecretAuth();
      const req = makeReq(); // no header
      const { res } = makeRes();
      const next = makeNext();

      middleware.use(req, res, next);

      // timingSafeEqual must not be called with mismatched lengths
      expect(timingSafeEqualSpy).not.toHaveBeenCalled();

      timingSafeEqualSpy.mockRestore();
    });

    it('does not invoke timingSafeEqual when token length differs from secret length', () => {
      const timingSafeEqualSpy = vi.spyOn(crypto, 'timingSafeEqual');

      const middleware = new SharedSecretAuth();
      const req = makeReq('Bearer short'); // shorter than VALID_SECRET
      const { res } = makeRes();
      const next = makeNext();

      middleware.use(req, res, next);

      expect(timingSafeEqualSpy).not.toHaveBeenCalled();

      timingSafeEqualSpy.mockRestore();
    });
  });

  describe('when VAULT_MANAGER_INTERNAL_SECRET is not configured', () => {
    it('returns 401 if the env var is missing', () => {
      delete process.env.VAULT_MANAGER_INTERNAL_SECRET;

      const middleware = new SharedSecretAuth();
      const req = makeReq(`Bearer ${VALID_SECRET}`);
      const { res, status } = makeRes();
      const next = makeNext();

      middleware.use(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(401);

      // Restore for subsequent tests
      process.env.VAULT_MANAGER_INTERNAL_SECRET = VALID_SECRET;
    });
  });
});
